import { NextResponse } from "next/server";
import { desc, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db/index";
import {
  assignments, checkIns, conversations, courses, gems, goals, liftLog,
  messages, metrics, routineLog, settings,
} from "@/db/schema";
import { getSession } from "@/lib/auth";
import { today } from "@/agents/context";
import { prayerBlocks } from "@/core/prayer";
import { dayFor, trackedSlots, type Day } from "@/core/routine";
import { consistency, windowEnding } from "@/core/consistency";
import { to12h, toHm } from "@/core/types";

export const dynamic = "force-dynamic";

/**
 * A plain-text dump of the whole state, for pasting into a conversation.
 *
 * Carries no secrets: no connection string, no API key, no session value. It
 * does carry schedule and bodyweight data, so it sits behind the session like
 * every other page.
 */
export async function GET() {
  const session = await getSession();
  if (!session.loggedIn) return new NextResponse("Not logged in.", { status: 401 });

  const date = today();
  const fortnight = windowEnding(date, 14);

  const [settingsRow, goalRows, courseRows, assignmentRows, logRows, checkInRows, metricRows, liftRows, hubRows] =
    await Promise.all([
      db.select().from(settings).limit(1),
      db.select().from(goals).where(eq(goals.active, true)),
      db.select().from(courses).orderBy(courses.period),
      db.select().from(assignments).where(eq(assignments.status, "open")).orderBy(assignments.dueDate),
      db.select().from(routineLog).where(gte(routineLog.onDate, fortnight.from)).orderBy(desc(routineLog.onDate)),
      db.select().from(checkIns).where(gte(checkIns.onDate, fortnight.from)).orderBy(desc(checkIns.onDate)),
      db.select().from(metrics).where(gte(metrics.onDate, fortnight.from)).orderBy(metrics.onDate),
      db.select().from(liftLog).where(gte(liftLog.onDate, fortnight.from)).orderBy(desc(liftLog.onDate)),
      db
        .select({ role: messages.role, content: messages.content, gem: gems.label })
        .from(messages)
        .innerJoin(conversations, eq(messages.conversationId, conversations.id))
        .innerJoin(gems, eq(conversations.gemId, gems.id))
        .orderBy(desc(messages.createdAt))
        .limit(10),
    ]);

  const L: string[] = [];
  const s = settingsRow[0];

  L.push(`STATE - ${date} (${DateTime.fromISO(date).toFormat("cccc")})`);
  L.push("=".repeat(58));

  const day = dayFor(date);
  L.push(`\n## Today - ${day.type} day`);
  const marked = new Map(logRows.filter((r) => r.onDate === date).map((r) => [r.slotKey, r.status]));
  for (const slot of day.slots) {
    const mark = slot.tracked ? ` [${marked.get(slot.key) ?? "-"}]` : "";
    const span = slot.end > slot.start ? `${to12h(slot.start)}-${to12h(slot.end)}` : to12h(slot.start);
    L.push(`  ${span.padEnd(19)} ${slot.label}${mark}`);
  }

  L.push(`\n## Consistency - last 14 days`);
  const score = consistency(
    fortnight.from,
    fortnight.to,
    logRows.map((r) => ({ onDate: r.onDate, slotKey: r.slotKey, status: r.status as "done" | "missed" })),
  );
  L.push(`  core hours   ${Math.round(score.core * 100)}%`);
  L.push(`  streak       ${score.currentStreak} (best ${score.bestStreak})`);
  for (const slot of score.slots) {
    L.push(`  ${slot.label.padEnd(22)} ${slot.done}/${slot.scheduled}  ${slot.silent} unanswered`);
  }

  L.push("\n## Settings");
  if (!s) {
    L.push("  NONE - the seed has not run. Run: npm run db:seed");
  } else {
    L.push(`  location        ${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)} (${s.timezone})`);
    L.push(`  wake            ${toHm(day.wake)}, lights out ${toHm(day.lightsOut)}`);
    L.push(`  sleep target    ${(s.targetSleepMin / 60).toFixed(1)}h`);
    L.push(`  wrestling       ${s.wrestlingPhase}`);
    L.push(`  restrictions    ${(s.restrictions ?? []).join(", ") || "none"}`);
  }

  L.push("\n## Prayer today");
  for (const b of prayerBlocks(date)) {
    L.push(`  ${b.label.padEnd(15)} ${to12h(b.start)}  window until ${to12h(b.window.end)}`);
  }

  L.push(`\n## Goals (${goalRows.length})`);
  for (const g of goalRows) L.push(`  [${g.domain}] ${g.northStar}`);

  L.push(`\n## Courses (${courseRows.length})`);
  for (const c of courseRows) L.push(`  P${c.period} ${c.name} (${c.rigor}, counts as ${c.domain})`);

  L.push(`\n## Open assignments (${assignmentRows.length})`);
  if (assignmentRows.length === 0) L.push("  none - nothing filed yet");
  for (const a of assignmentRows) {
    const course = courseRows.find((c) => c.id === a.courseId);
    L.push(`  [${course?.code ?? "?"}] ${a.title} - ${a.kind}, due ${a.dueDate ?? "?"}, ~${a.estimatedMin}min`);
  }

  L.push(`\n## Sleep reported (${checkInRows.length} nights)`);
  if (checkInRows.length === 0) L.push("  none logged");
  for (const c of checkInRows) {
    L.push(`  ${c.onDate}: ${c.sleepMin ? (c.sleepMin / 60).toFixed(1) + "h" : "?"}${c.bedtimeMin != null ? ` (bed ${toHm(c.bedtimeMin)}, up ${toHm(c.wakeMin ?? 0)})` : ""}`);
  }

  L.push(`\n## Metrics (${metricRows.length})`);
  if (metricRows.length === 0) L.push("  none logged");
  for (const m of metricRows) L.push(`  ${m.onDate} ${m.kind} = ${m.value}${m.unit ?? ""}`);

  L.push(`\n## Lifts logged (${liftRows.length} sets)`);
  if (liftRows.length === 0) L.push("  none");
  for (const l of liftRows.slice(0, 20)) {
    L.push(`  ${l.onDate} ${l.exerciseName}: ${l.reps} reps @ ${l.weight ?? "bw"}`);
  }

  L.push(`\n## Recent hub turns (${hubRows.length})`);
  if (hubRows.length === 0) L.push("  none");
  for (const t of [...hubRows].reverse()) {
    const text = t.content.replace(/\s+/g, " ");
    L.push(`  [${t.gem}/${t.role}] ${text.slice(0, 240)}${text.length > 240 ? "..." : ""}`);
  }

  return new NextResponse(L.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
