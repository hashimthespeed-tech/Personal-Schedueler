import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import { blocks, checkIns } from "@/db/schema";
import { getSession } from "@/lib/auth";

const body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sleepMin: z.number().int().min(0).max(960),
  energy: z.number().int().min(1).max(5),
  slippedBlockIds: z.array(z.number().int()),
  note: z.string().nullable(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }
  const input = parsed.data;

  await db
    .insert(checkIns)
    .values({
      onDate: input.date,
      sleepMin: input.sleepMin,
      energy: input.energy,
      slippedBlockIds: input.slippedBlockIds,
      note: input.note,
    })
    .onConflictDoUpdate({
      target: checkIns.onDate,
      set: {
        sleepMin: input.sleepMin,
        energy: input.energy,
        slippedBlockIds: input.slippedBlockIds,
        note: input.note,
      },
    });

  // mark what happened before the plan is rebuilt over the top of it
  const slipped = new Set(input.slippedBlockIds);
  const todays = await db.select().from(blocks).where(eq(blocks.onDate, input.date));
  for (const b of todays) {
    await db.update(blocks).set({ completed: !slipped.has(b.id) }).where(eq(blocks.id, b.id));
  }

  return NextResponse.json({ ok: true });
}
