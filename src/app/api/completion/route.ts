import { NextResponse } from "next/server";
import { and, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db/index";
import { routineLog, scheduledTasks } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { today } from "@/core/clock";
import { recurringAssignedTasks, scoreRange, type AssignedTask, type AssignedTaskStatus } from "@/core/daily-completion";

export const dynamic = "force-dynamic";
const RECURRING_TRACKING_START = "2026-09-24";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const through = new URL(request.url).searchParams.get("through") ?? today();
  const end = DateTime.fromISO(through);
  if (!end.isValid || end.toISODate() !== through || through > today()) {
    return NextResponse.json({ ok: false, error: "Choose a valid day up to today." }, { status: 400 });
  }
  const from = end.minus({ days: 13 }).toISODate()!;
  const [rows, marks] = await Promise.all([
    db.select().from(scheduledTasks)
      .where(and(gte(scheduledTasks.onDate, from), lte(scheduledTasks.onDate, through))),
    db.select({ onDate: routineLog.onDate, slotKey: routineLog.slotKey, status: routineLog.status })
      .from(routineLog).where(and(gte(routineLog.onDate, from), lte(routineLog.onDate, through))),
  ]);
  const tasks: AssignedTask[] = rows.map((row) => ({
    id: String(row.id), date: row.onDate, title: row.title,
    status: row.status as AssignedTaskStatus,
  }));
  tasks.push(...recurringAssignedTasks(from, through, marks, RECURRING_TRACKING_START));
  return NextResponse.json({ ok: true, days: scoreRange(from, through, tasks), tasks });
}
