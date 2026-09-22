import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import { goalEntries, goalRecords } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { today } from "@/core/clock";
import { assessFiniteGoal, assessMonthlyGoal, finishGoal, type Goal, type GoalEntry } from "@/core/goals";

export const dynamic = "force-dynamic";

const common = {
  category: z.enum(["school", "religion", "fitness", "ai", "money"]),
  title: z.string().trim().min(1).max(120),
  target: z.number().finite().positive(),
  targetMax: z.number().finite().positive().optional(),
  comparison: z.enum(["at-least", "at-most", "range"]),
  unit: z.string().trim().min(1).max(30),
};

const create = z.discriminatedUnion("kind", [
  z.object({ action: z.literal("create"), kind: z.literal("finite"), measure: z.enum(["sum", "latest"]),
    startValue: z.number().finite().optional(), ...common }),
  z.object({ action: z.literal("create"), kind: z.literal("ongoing"), measure: z.enum(["daily-number", "daily-check"]),
    allowedMisses: z.number().int().min(0).max(31), ...common }),
]);

const log = z.object({ action: z.literal("log"), id: z.number().int().positive(),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: z.number().finite().min(0) });
const finish = z.object({ action: z.literal("finish"), id: z.number().int().positive() });
const body = z.union([create, log, finish]);

type GoalRow = typeof goalRecords.$inferSelect;

function toGoal(row: GoalRow): Goal {
  const base = {
    id: row.id,
    category: row.category as Goal["category"],
    title: row.title,
    target: row.target,
    ...(row.targetMax === null ? {} : { targetMax: row.targetMax }),
    comparison: row.comparison as Goal["comparison"],
    unit: row.unit,
    createdOn: row.createdOn,
    ...(row.completedOn === null ? {} : { completedOn: row.completedOn }),
  };
  if (row.kind === "ongoing") {
    return { ...base, kind: "ongoing", measure: row.measure as "daily-number" | "daily-check",
      allowedMisses: row.allowedMisses ?? 2 };
  }
  return { ...base, kind: "finite", measure: row.measure as "sum" | "latest",
    ...(row.startValue === null ? {} : { startValue: row.startValue }) };
}

export async function GET() {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });
  const [records, measurements] = await Promise.all([
    db.select().from(goalRecords).orderBy(asc(goalRecords.createdAt)),
    db.select().from(goalEntries).orderBy(asc(goalEntries.onDate), asc(goalEntries.id)),
  ]);
  const entriesByGoal = new Map<number, GoalEntry[]>();
  for (const entry of measurements) {
    const list = entriesByGoal.get(entry.goalId) ?? [];
    list.push({ goalId: entry.goalId, onDate: entry.onDate, value: entry.value });
    entriesByGoal.set(entry.goalId, list);
  }
  const asOf = today();
  return NextResponse.json({ ok: true, today: asOf, goals: records.map((row) => {
    const goal = toGoal(row);
    const entries = entriesByGoal.get(goal.id) ?? [];
    return { ...goal, progress: goal.kind === "ongoing" ? assessMonthlyGoal(goal, entries, asOf) : assessFiniteGoal(goal, entries) };
  }) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ ok: false, error: parsed.error.issues[0]?.message ?? "Invalid goal." }, { status: 400 });
  const data = parsed.data;

  if (data.action === "create") {
    if (data.comparison === "range" && (data.targetMax === undefined || data.targetMax < data.target)) {
      return NextResponse.json({ ok: false, error: "A range needs an upper target at least as large as the lower target." }, { status: 400 });
    }
    if (data.kind === "finite" && data.measure === "latest" &&
        (data.startValue === undefined || (data.comparison === "at-least" && data.startValue >= data.target))) {
      return NextResponse.json({ ok: false, error: "Set a starting number below the target." }, { status: 400 });
    }
    const [made] = await db.insert(goalRecords).values({
      category: data.category, title: data.title, kind: data.kind, measure: data.measure,
      target: data.target, targetMax: data.targetMax ?? null, comparison: data.comparison,
      unit: data.unit, startValue: data.kind === "finite" ? data.startValue ?? null : null,
      allowedMisses: data.kind === "ongoing" ? data.allowedMisses : null,
      createdOn: today(),
    }).returning({ id: goalRecords.id });
    return NextResponse.json({ ok: true, id: made?.id });
  }

  const [row] = await db.select().from(goalRecords).where(eq(goalRecords.id, data.id)).limit(1);
  if (!row) return NextResponse.json({ ok: false, error: "Goal not found." }, { status: 404 });
  if (row.completedOn) return NextResponse.json({ ok: false, error: "Completed goals cannot be changed." }, { status: 409 });

  if (data.action === "log") {
    if (data.onDate < row.createdOn || data.onDate > today()) {
      return NextResponse.json({ ok: false, error: "Choose a date from this goal's active history." }, { status: 400 });
    }
    await db.insert(goalEntries).values({ goalId: row.id, onDate: data.onDate, value: data.value })
      .onConflictDoUpdate({ target: [goalEntries.goalId, goalEntries.onDate], set: { value: data.value } });
    return NextResponse.json({ ok: true });
  }

  const entries = await db.select().from(goalEntries).where(eq(goalEntries.goalId, row.id));
  try {
    finishGoal(toGoal(row), entries.map((entry) => ({ goalId: entry.goalId, onDate: entry.onDate, value: entry.value })), today());
  } catch {
    return NextResponse.json({ ok: false, error: "Reach this goal's target before finishing it." }, { status: 409 });
  }
  await db.update(goalRecords).set({ completedOn: today() }).where(eq(goalRecords.id, row.id));
  return NextResponse.json({ ok: true, askNextTarget: true });
}
