import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import { conversations, gems, messages } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { runGem } from "@/agents/gem";

export const maxDuration = 300;

const createBody = z.object({ gemId: z.number().int() });
const sendBody = z.object({
  conversationId: z.number().int(),
  message: z.string().min(1).max(8000),
});
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

  return NextResponse.json({
    ok: true,
    conversation: { id: convo.id, title: convo.title, gemId: convo.gemId },
    gem: gem ? { id: gem.id, label: gem.label, blurb: gem.blurb, domain: gem.domain, memory: gem.memory } : null,
    messages: rows.map((m) => ({ id: m.id, role: m.role, content: m.content, actions: m.actions })),
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
  if (!send.success) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });

  try {
    const reply = await runGem(send.data.conversationId, send.data.message);
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

  await db.delete(messages).where(eq(messages.conversationId, parsed.data.conversationId));
  await db.delete(conversations).where(eq(conversations.id, parsed.data.conversationId));

  return NextResponse.json({ ok: true });
}
