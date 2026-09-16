import { NextResponse } from "next/server";
import { desc, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db/index";
import {
  agentThreads, assignments, blocks, checkIns, courses, goals, liftLog, metrics,
  planReviews, prayerLog, settings, tasks, unplaced, completions,
} from "@/db/schema";
import { getSession } from "@/lib/auth";
import { today } from "@/agents/context";
import { prayerBlocks } from "@/core/prayer";
import { sleepNightFor, bedtimeFor } from "@/core/sleep";
import { evaluateGate } from "@/coach/gating";
import { slotsForHorizon, totalMinutes } from "@/core/slots";
import { to12h, toHm } from "@/core/types";

export const dynamic = "force-dynamic";

/**
 * A plain-text dump of everything needed to reason about the current plan,
 * for pasting into a conversation. Text rather than JSON so it reads without
 * tooling.
 *
 * Carries no secrets: no connection string, no API key, no session value. It
 * does carry schedule and bodyweight data, so it sits behind the session like
 * every other page.
 */
export async function GET() {
  const session = await getSession();
  if (!session.loggedIn) return new NextResponse("Not logged in.", { status: 401 });

  const date = today();
  const weekAgo = DateTime.fromISO(date).minus({ days: 7 }).toISODate() ?? date;

  const [
    settingsRow, goalRows, courseRows, assignmentRows, taskRows, blockRows,
    unplacedRows, checkInRows, prayerRows, metricRows, liftRows, reviewRows, threadRows,
    completionRows,
  ] = await Promise.all([
    db.select().from(settings).limit(1),
    db.select().from(goals).where(eq(goals.active, true)),
    db.select().from(courses).orderBy(courses.period),
    db.select().from(assignments).where(eq(assignments.status, "open")).orderBy(assignments.dueDate),
    db.select().from(tasks).where(eq(tasks.status, "open")),
    db.select().from(blocks).orderBy(blocks.onDate, blocks.startMin),
    db.select().from(unplaced).orderBy(desc(unplaced.createdAt)),
    db.select().from(checkIns).where(gte(checkIns.onDate, weekAgo)).orderBy(desc(checkIns.onDate)),
    db.select().from(prayerLog).where(gte(prayerLog.onDate, weekAgo)),
    db.select().from(metrics).where(gte(metrics.onDate, weekAgo)).orderBy(metrics.onDate),
    db.select().from(liftLog).where(gte(liftLog.onDate, weekAgo)).orderBy(desc(liftLog.onDate)),
    db.select().from(planReviews).orderBy(desc(planReviews.createdAt)).limit(1),
    db.select().from(agentThreads).orderBy(desc(agentThreads.createdAt)).limit(12),
    db.select().from(completions).where(gte(completions.onDate, weekAgo)).orderBy(desc(completions.onDate)),
  ]);

  const L: string[] = [];
  const s = settingsRow[0];

  L.push(`SCHEDULER STATE - ${date} (${DateTime.fromISO(date).toFormat("cccc")})`);
  L.push("=".repeat(58));

  L.push("\n## Settings");
  if (!s) {
    L.push("  NONE - the seed has not run. Run: npm run db:seed");
  } else {
    L.push(`  location        ${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)} (${s.timezone})`);
    L.push(`  wake / bedtime  ${toHm(s.dayStartMin)} / ${toHm(bedtimeFor(date))} (goal ${toHm(s.goalBedtimeMin)}, ${s.rampMinutesPerWeek}min per week)`);
    L.push(`  sleep target    ${(s.targetSleepMin / 60).toFixed(1)}h, Fajr costs ${s.fajrInterruptionMin}min`);
    L.push(`  wrestling       ${s.wrestlingPhase}`);
    L.push(`  restrictions    ${(s.restrictions ?? []).join(", ") || "none"}`);
    L.push(`  weekly cap      ${Math.round(s.maxUtilization * 100)}%`);
  }

  L.push("\n## Sleep");
  const fajrRow = prayerRows.find((r) => r.onDate === date && r.block === "fajr");
  const prayedFajr = fajrRow?.status === "on-time" || fajrRow?.status === "late";
  const night = sleepNightFor(date, prayedFajr);
  L.push(`  modelled last night  ${(night.netSleepMin / 60).toFixed(1)}h net (${night.vsTargetMin >= 0 ? "+" : ""}${(night.vsTargetMin / 60).toFixed(1)}h vs target)`);
  L.push(`  Fajr                 ${to12h(night.fajr)}, interruption ${night.interruptionMin}min`);

  L.push("\n## Prayer today");
  for (const b of prayerBlocks(date)) {
    L.push(`  ${b.label.padEnd(15)} ${to12h(b.start)}  window until ${to12h(b.window.end)}`);
  }

  L.push("\n## Coach gate");
  const weights = metricRows.filter((m) => m.kind === "bodyweight");
  const gate = evaluateGate({
    recentWeights: weights.map((w) => ({ date: w.onDate, lb: w.value })),
    recentNetSleepMin: [night.netSleepMin],
    targetSleepMin: s?.targetSleepMin ?? 480,
  });
  L.push(`  verdict          ${gate.verdict}`);
  L.push(`  may add load     ${gate.allowProgression ? "YES" : "NO"}`);
  L.push(`  reason           ${gate.reason}`);
  L.push(`  weigh-ins logged ${weights.length}`);

  L.push(`\n## Goals (${goalRows.length})`);
  for (const g of goalRows) L.push(`  [${g.domain}] ${g.northStar}${g.currentFocus ? ` - ${g.currentFocus}` : ""}`);

  L.push(`\n## Courses (${courseRows.length})`);
  for (const c of courseRows) L.push(`  P${c.period} ${c.name} (${c.rigor}, counts as ${c.domain})`);

  L.push(`\n## Open assignments (${assignmentRows.length})`);
  if (assignmentRows.length === 0) L.push("  none");
  for (const a of assignmentRows) L.push(`  ${a.title} - ${a.kind}, due ${a.dueDate ?? "?"}, ~${a.estimatedMin}min`);

  L.push(`\n## Task pool (${taskRows.length} open)`);
  if (taskRows.length === 0) L.push("  EMPTY - nothing to schedule. Talk to an agent.");
  for (const t of taskRows) {
    const bits = [
      `${t.durationMin}min`,
      t.minChunkMin ? `splits ${t.minChunkMin}+` : "indivisible",
      t.dayPart ?? "anytime",
      t.recurrence === "once" ? "one-off" : t.recurrence,
      `energy ${t.energy}`,
      `pri ${t.priority}`,
      t.deadline ? `due ${t.deadline}` : null,
      t.allowedWeekdays ? `days ${t.allowedWeekdays.join("/")}` : null,
      t.earliestTime != null ? `after ${to12h(t.earliestTime)}` : null,
      t.latestTime != null ? `before ${to12h(t.latestTime)}` : null,
      t.spacingHours ? `${t.spacingHours}h apart (${t.spacingGroup})` : null,
      t.oncePerDay ? "once/day" : null,
      t.goalId ? `goal ${t.goalId}` : "NO GOAL",
      t.steps?.length ? `${t.steps.length} steps` : null,
      t.movementTags?.length ? `moves: ${t.movementTags.join("/")}` : null,
    ].filter(Boolean);
    L.push(`  [${t.domain}] ${t.title}`);
    L.push(`      ${bits.join(", ")}  <- ${t.sourceAgent}`);
  }

  const capacity = totalMinutes(slotsForHorizon(date, 7));
  const scheduled = blockRows.reduce((n, b) => n + (b.endMin - b.startMin), 0);
  L.push(`\n## Schedule (${blockRows.length} blocks, ${(scheduled / 60).toFixed(1)}h of ${(capacity / 60).toFixed(1)}h free = ${capacity ? Math.round((scheduled / capacity) * 100) : 0}%)`);
  let day = "";
  for (const b of blockRows) {
    if (b.onDate !== day) {
      day = b.onDate;
      L.push(`  ${DateTime.fromISO(day).toFormat("ccc d LLL")}`);
    }
    const chunk = b.chunkCount && b.chunkCount > 1 ? ` (${b.chunkIndex}/${b.chunkCount})` : "";
    const done = b.completed === true ? " [done]" : b.completed === false ? " [slipped]" : "";
    L.push(`      ${to12h(b.startMin)}-${to12h(b.endMin)} [${b.domain}] ${b.title}${chunk}${done}`);
  }
  if (blockRows.length === 0) L.push("  nothing scheduled");

  L.push(`\n## Did not fit (${unplacedRows.length})`);
  if (unplacedRows.length === 0) L.push("  everything fit");
  for (const u of unplacedRows) L.push(`  [${u.domain}] ${u.title}\n      ${u.reason}: ${u.detail}`);

  L.push(`\n## Completions (${completionRows.length} in last 7 days)`);
  if (completionRows.length === 0) L.push("  none recorded");
  for (const c of completionRows.slice(0, 30)) {
    L.push(`  ${c.onDate} ${c.skipped ? "SKIPPED" : "done"} [${c.domain}] ${c.title} (${c.minutes}min, goal ${c.goalId ?? "-"})`);
  }

  L.push(`\n## Check-ins (${checkInRows.length} in last 7 days)`);
  if (checkInRows.length === 0) L.push("  none logged");
  for (const c of checkInRows) {
    L.push(`  ${c.onDate}: ${c.sleepMin ? (c.sleepMin / 60).toFixed(1) + "h" : "?"} sleep, energy ${c.energy ?? "?"}, ${(c.slippedBlockIds ?? []).length} slipped${c.note ? ` - "${c.note}"` : ""}`);
  }

  L.push(`\n## Metrics (${metricRows.length})`);
  if (metricRows.length === 0) L.push("  none logged");
  for (const m of metricRows) L.push(`  ${m.onDate} ${m.kind} = ${m.value}${m.unit ?? ""}`);

  L.push(`\n## Lifts logged (${liftRows.length} sets)`);
  if (liftRows.length === 0) L.push("  none");
  for (const l of liftRows.slice(0, 20)) L.push(`  ${l.onDate} ${l.exerciseName}: ${l.reps} reps @ ${l.weight ?? "bw"}`);

  L.push(`\n## Prayer log (${prayerRows.length} entries)`);
  if (prayerRows.length === 0) L.push("  none logged");

  L.push("\n## Last nightly review");
  const review = reviewRows[0];
  L.push(review ? `  ${review.onDate}: ${review.summary}` : "  never run");

  L.push(`\n## Recent agent turns (${threadRows.length})`);
  for (const t of [...threadRows].reverse()) {
    const text = t.content.replace(/\s+/g, " ");
    L.push(`  [${t.agent}/${t.role}] ${text.slice(0, 300)}${text.length > 300 ? "..." : ""}`);
  }

  return new NextResponse(L.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
