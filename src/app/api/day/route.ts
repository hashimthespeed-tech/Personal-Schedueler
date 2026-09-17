import { NextResponse } from "next/server";
import { and, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import { dayAdjustments, routineLog } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { dayFor } from "@/core/routine";
import { consistency, windowEnding } from "@/core/consistency";
import { today } from "@/agents/context";

export const dynamic = "force-dynamic";

const mark = z.object({
  action: z.literal("mark"),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotKey: z.string().min(1).max(60),
  /** null clears a mark, which is how he undoes a mis-tap */
  status: z.enum(["done", "missed"]).nullable(),
  note: z.string().max(500).nullable().optional(),
});

const adjust = z.object({
  action: z.literal("adjust"),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  extraSchoolHour: z.boolean(),
});

const body = z.union([mark, adjust]);

/** One day, its marks, and how the last fortnight has gone. */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const asked = new URL(request.url).searchParams.get("date");
  const date = asked && /^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : today();

  const adjustment = (
    await db.select().from(dayAdjustments).where(eq(dayAdjustments.onDate, date)).limit(1)
  )[0];

  const day = dayFor(date, { extraSchoolHour: adjustment?.extraSchoolHour === true });

  const marks = await db.select().from(routineLog).where(eq(routineLog.onDate, date));

  const window = windowEnding(date, 14);
  const recent = await db
    .select()
    .from(routineLog)
    .where(gte(routineLog.onDate, window.from));

  const score = consistency(
    window.from,
    window.to,
    recent.map((r) => ({
      onDate: r.onDate,
      slotKey: r.slotKey,
      status: r.status as "done" | "missed",
    })),
  );

  return NextResponse.json({
    ok: true,
    day,
    extraSchoolHour: adjustment?.extraSchoolHour === true,
    marks: Object.fromEntries(marks.map((m) => [m.slotKey, m.status])),
    consistency: { core: score.core, currentStreak: score.currentStreak, slots: score.slots },
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Bad request." },
      { status: 400 },
    );
  }

  if (parsed.data.action === "adjust") {
    await db
      .insert(dayAdjustments)
      .values({ onDate: parsed.data.onDate, extraSchoolHour: parsed.data.extraSchoolHour })
      .onConflictDoUpdate({
        target: dayAdjustments.onDate,
        set: { extraSchoolHour: parsed.data.extraSchoolHour },
      });
    return NextResponse.json({ ok: true });
  }

  const { onDate, slotKey, status, note } = parsed.data;

  // clearing a mark removes the row rather than storing a third state: a day
  // he did not answer and a day he un-ticked should look identical
  if (status === null) {
    await db
      .delete(routineLog)
      .where(and(eq(routineLog.onDate, onDate), eq(routineLog.slotKey, slotKey)));
    return NextResponse.json({ ok: true, status: null });
  }

  await db
    .insert(routineLog)
    .values({ onDate, slotKey, status, note: note ?? null })
    .onConflictDoUpdate({
      target: [routineLog.onDate, routineLog.slotKey],
      set: { status, note: note ?? null },
    });

  return NextResponse.json({ ok: true, status });
}
