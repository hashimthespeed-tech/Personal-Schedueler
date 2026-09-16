import { NextResponse } from "next/server";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import { attachments, conversations, gems, messages } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { runGem } from "@/agents/gem";
import { ACCEPTED, MAX_FILES, MAX_TOTAL_BASE64, describeSize } from "@/lib/attachments";

export const maxDuration = 300;

const createBody = z.object({ gemId: z.number().int() });
const fileBody = z.object({
  name: z.string().min(1).max(200),
  mediaType: z.string().refine((t) => ACCEPTED.includes(t), "Unsupported file type."),
  data: z.string().min(1),
});

const sendBody = z
  .object({
    conversationId: z.number().int(),
    message: z.string().max(8000).default(""),
    files: z.array(fileBody).max(MAX_FILES).default([]),
  })
  // a message can be a file with nothing typed, but it cannot be nothing at all
  .refine((b) => b.message.trim().length > 0 || b.files.length > 0, "Say something or attach a file.");
const deleteBody = z.object({ conversationId: z.number().int() });

/** Messages in one conversation. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ ok: false }, { status: 400 });

  const convo = (await db.select().from(conversations).where(eq(conversations.id, id)).limit(1))[0];
  if (!convo) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  const gem = (await db.select().from(gems).where(eq(gems.id, convo.gemId)).limit(1))[0];
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(asc(messages.createdAt));

  // name and type only — the bytes are fetched per file from /api/attachments
  const files = rows.length
    ? await db
        .select({
          id: attachments.id,
          messageId: attachments.messageId,
          name: attachments.name,
          mediaType: attachments.mediaType,
          bytes: attachments.bytes,
        })
        .from(attachments)
        .where(inArray(attachments.messageId, rows.map((r) => r.id)))
        .orderBy(asc(attachments.id))
    : [];

  return NextResponse.json({
    ok: true,
    conversation: { id: convo.id, title: convo.title, gemId: convo.gemId },
    gem: gem ? { id: gem.id, label: gem.label, blurb: gem.blurb, domain: gem.domain, memory: gem.memory } : null,
    messages: rows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      actions: m.actions,
      files: files.filter((f) => f.messageId === m.id),
    })),
  });
}

/** Start a new conversation, or send a message into one. */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const payload = await request.json();

  const create = createBody.safeParse(payload);
  if (create.success) {
    const created = await db
      .insert(conversations)
      .values({ gemId: create.data.gemId })
      .returning({ id: conversations.id });
    return NextResponse.json({ ok: true, conversationId: created[0]?.id });
  }

  const send = sendBody.safeParse(payload);
  if (!send.success) {
    // say which part was wrong — "Bad request" sends you looking at the wrong thing
    const why = send.error.issues[0]?.message ?? "Bad request.";
    return NextResponse.json({ ok: false, error: why }, { status: 400 });
  }

  const weight = send.data.files.reduce((total, f) => total + f.data.length, 0);
  if (weight > MAX_TOTAL_BASE64) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `Those files come to about ${describeSize(weight * 0.75)}, and one message carries ` +
          `about ${describeSize(MAX_TOTAL_BASE64 * 0.75)}. Send them a couple at a time.`,
      },
      { status: 413 },
    );
  }

  try {
    const reply = await runGem(send.data.conversationId, send.data.message, send.data.files);
    return NextResponse.json({ ok: true, ...reply });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed." },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = deleteBody.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const doomed = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.conversationId, parsed.data.conversationId));

  if (doomed.length > 0) {
    await db.delete(attachments).where(inArray(attachments.messageId, doomed.map((m) => m.id)));
  }
  await db.delete(messages).where(eq(messages.conversationId, parsed.data.conversationId));
  await db.delete(conversations).where(eq(conversations.id, parsed.data.conversationId));

  return NextResponse.json({ ok: true });
}
