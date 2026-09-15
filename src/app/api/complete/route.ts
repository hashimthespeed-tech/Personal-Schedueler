import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import { blocks, completions } from "@/db/schema";
import { getSession } from "@/lib/auth";

const body = z.object({
  blockId: z.number().int(),
  skipped: z.boolean().default(false),
  /** false undoes a previous completion */
  done: z.boolean().default(true),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const { blockId, skipped, done } = parsed.data;
  const block = (await db.select().from(blocks).where(eq(blocks.id, blockId)).limit(1))[0];
  if (!block) return NextResponse.json({ ok: false, error: "No such block." }, { status: 404 });

  if (!done) {
    await db.delete(completions).where(eq(completions.blockId, blockId));
    await db.update(blocks).set({ completed: null }).where(eq(blocks.id, blockId));
    return NextResponse.json({ ok: true, completed: null });
  }

  // one record per block — tapping twice corrects rather than double-counts
  const existing = await db
    .select()
    .from(completions)
    .where(and(eq(completions.blockId, blockId)))
    .limit(1);

  const row = {
    blockId,
    taskId: block.taskId,
    title: block.title,
    domain: block.domain,
    goalId: block.goalId,
    onDate: block.onDate,
    plannedStartMin: block.startMin,
    plannedEndMin: block.endMin,
    minutes: skipped ? 0 : block.endMin - block.startMin,
    skipped,
    completedAt: new Date(),
  };

  if (existing[0]) {
    await db.update(completions).set(row).where(eq(completions.id, existing[0].id));
  } else {
    await db.insert(completions).values(row);
  }

  await db.update(blocks).set({ completed: !skipped }).where(eq(blocks.id, blockId));

  return NextResponse.json({ ok: true, completed: !skipped });
}
