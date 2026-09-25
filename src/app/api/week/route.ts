import { NextResponse } from "next/server";
import { and, gte, lte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db/index";
import { routineLog, scheduledTasks } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { today } from "@/core/clock";
import { buildDayFrame } from "@/core/day-frame";
import { weekDates } from "@/core/week";
import { recurringItemsForToday } from "@/core/today-timeline";

export const dynamic = "force-dynamic";

function validDate(value: string) {
  const parsed = DateTime.fromISO(value);
  return parsed.isValid && parsed.toISODate() === value;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
  const anchor = new URL(request.url).searchParams.get("date") ?? today();
  if (!validDate(anchor)) return NextResponse.json({ ok: false, error: "Choose a valid date." }, { status: 400 });
  const dates = weekDates(anchor);
  const [tasks, marks] = await Promise.all([
    db.select().from(scheduledTasks).where(and(
      gte(scheduledTasks.onDate, dates[0]!), lte(scheduledTasks.onDate, dates[6]!),
    )),
    db.select({ onDate: routineLog.onDate, slotKey: routineLog.slotKey, status: routineLog.status })
      .from(routineLog).where(and(gte(routineLog.onDate, dates[0]!), lte(routineLog.onDate, dates[6]!))),
  ]);
  return NextResponse.json({ ok: true, weekStart: dates[0], weekEnd: dates[6], days: dates.map((date) => ({
    date,
    frame: buildDayFrame(date, { sleepMode: "current" }),
    tasks: tasks.filter((task) => task.onDate === date),
    recurring: recurringItemsForToday(date, marks.filter((mark) => mark.onDate === date)),
  })) });
}
