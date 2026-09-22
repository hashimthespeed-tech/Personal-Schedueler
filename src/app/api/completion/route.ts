import { NextResponse } from "next/server";
import { and, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db/index";
import { scheduledTasks } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { today } from "@/core/clock";
import { scoreRange, type AssignedTask, type AssignedTaskStatus } from "@/core/daily-completion";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const through = new URL(request.url).searchParams.get("through") ?? today();
  const end = DateTime.fromISO(through);
  if (!end.isValid || end.toISODate() !== through || through > today()) {
    return NextResponse.json({ ok: false, error: "Choose a valid day up to today." }, { status: 400 });
  }
  const from = end.minus({ days: 13 }).toISODate()!;
  const rows = await db.select().from(scheduledTasks)
    .where(and(gte(scheduledTasks.onDate, from), lte(scheduledTasks.onDate, through)));
  const tasks: AssignedTask[] = rows.map((row) => ({
    id: String(row.id), date: row.onDate, title: row.title,
    status: row.status as AssignedTaskStatus,
  }));
  return NextResponse.json({ ok: true, days: scoreRange(from, through, tasks), tasks });
}
