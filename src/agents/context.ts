/**
 * The shared-state snapshot every specialist reads.
 *
 * Built once per request and placed at the front of the prompt behind a cache
 * breakpoint, so repeated turns in a thread re-read it cheaply.
 *
 * This is the concrete payoff of the hub: the coach sees sleep and the tutor
 * sees training load, because there is one store rather than four.
 */

import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "../db/index.js";
import {
  assignments, blocks, checkIns, courses, goals, liftLog, metrics, prayerLog, settings, tasks, unplaced,
} from "../db/schema.js";
import { prayerBlocks, LA_MESA, type PrayerConfig } from "../core/prayer.js";
import { sleepNightFor, bedtimeFor, DEFAULT_SLEEP, type SleepModel } from "../core/sleep.js";
import { evaluateGate } from "../coach/gating.js";
import { to12h, toHm, type IsoDate } from "../core/types.js";
import type { SpecialistName } from "./specialists.js";

export function today(zone = LA_MESA.timezone): IsoDate {
  const iso = DateTime.now().setZone(zone).toISODate();
  if (!iso) throw new Error("Cannot resolve today's date");
  return iso;
}

function daysAgo(date: IsoDate, n: number): IsoDate {
  const iso = DateTime.fromISO(date).minus({ days: n }).toISODate();
  if (!iso) throw new Error(`Cannot rewind ${date}`);
  return iso;
}

async function loadSettings(): Promise<{ sleep: SleepModel; prayer: PrayerConfig; restrictions: string[]; wrestlingPhase: string }> {
  const row = (await db.select().from(settings).limit(1))[0];
  if (!row) {
    return {
      sleep: DEFAULT_SLEEP,
      prayer: LA_MESA,
      restrictions: [],
      wrestlingPhase: "preseason",
    };
  }
  return {
    sleep: {
      dayStart: row.dayStartMin,
      fajrInterruptionMin: row.fajrInterruptionMin,
      returnToSleep: true,
      targetSleepMin: row.targetSleepMin,
      startBedtime: row.startBedtimeMin,
      goalBedtime: row.goalBedtimeMin,
      rampMinutesPerWeek: row.rampMinutesPerWeek,
      rampStartDate: row.rampStartDate,
    },
    prayer: {
      latitude: row.latitude,
      longitude: row.longitude,
      timezone: row.timezone,
      fajrDurationMin: LA_MESA.fajrDurationMin,
      dhuhrAsrDurationMin: LA_MESA.dhuhrAsrDurationMin,
      maghribIshaDurationMin: LA_MESA.maghribIshaDurationMin,
    },
    restrictions: row.restrictions ?? [],
    wrestlingPhase: row.wrestlingPhase,
  };
}

/** Everything every agent sees, regardless of domain. */
async function commonContext(date: IsoDate): Promise<string> {
  const { sleep, prayer } = await loadSettings();
  const night = sleepNightFor(date, sleep, prayer);
  const bedtime = bedtimeFor(date, sleep);

  const activeGoals = await db.select().from(goals).where(eq(goals.active, true));
  const todaysBlocks = await db.select().from(blocks).where(eq(blocks.onDate, date)).orderBy(blocks.startMin);
  const openUnplaced = await db.select().from(unplaced).orderBy(desc(unplaced.createdAt)).limit(10);
  const recentCheckIns = await db.select().from(checkIns)
    .where(gte(checkIns.onDate, daysAgo(date, 7))).orderBy(desc(checkIns.onDate));

  const lines: string[] = [];

  lines.push(`# Shared state — ${DateTime.fromISO(date).toFormat("cccc d LLLL yyyy")}`);

  lines.push(`\n## Sleep`);
  lines.push(`Bedtime in force tonight: ${to12h(bedtime)} (ramping toward ${to12h(sleep.goalBedtime)}, 15 min/week).`);
  lines.push(`Last night: ${(night.netSleepMin / 60).toFixed(1)}h net after a ${night.interruptionMin} min Fajr wake.`);
  lines.push(
    night.vsTargetMin < 0
      ? `That is ${(Math.abs(night.vsTargetMin) / 60).toFixed(1)}h UNDER his ${(sleep.targetSleepMin / 60).toFixed(0)}h target.`
      : `That meets his ${(sleep.targetSleepMin / 60).toFixed(0)}h target.`,
  );
  if (recentCheckIns.length > 0) {
    const reported = recentCheckIns.filter((c) => c.sleepMin != null);
    if (reported.length > 0) {
      const avg = reported.reduce((s, c) => s + (c.sleepMin ?? 0), 0) / reported.length;
      lines.push(`Reported average over ${reported.length} logged nights: ${(avg / 60).toFixed(1)}h.`);
    }
    const energies = recentCheckIns.filter((c) => c.energy != null).map((c) => c.energy ?? 0);
    if (energies.length > 0) {
      lines.push(`Energy self-rating, recent: ${energies.join(", ")} (1-5).`);
    }
  } else {
    lines.push(`No check-ins logged yet — sleep figures above are the model, not measurements.`);
  }

  lines.push(`\n## Prayer times today`);
  for (const b of prayerBlocks(date, prayer)) {
    lines.push(`- ${b.label}: enters ${to12h(b.start)}, window until ${to12h(b.window.end)}`);
  }

  if (activeGoals.length > 0) {
    lines.push(`\n## Goals`);
    for (const g of activeGoals) {
      lines.push(`- [${g.domain}] ${g.northStar}${g.currentFocus ? ` — currently: ${g.currentFocus}` : ""}`);
    }
  }

  lines.push(`\n## Today's schedule`);
  if (todaysBlocks.length === 0) {
    lines.push(`Nothing scheduled yet.`);
  } else {
    for (const b of todaysBlocks) {
      lines.push(`- ${to12h(b.startMin)}-${to12h(b.endMin)} [${b.domain}] ${b.title}`);
    }
  }

  if (openUnplaced.length > 0) {
    lines.push(`\n## Did not fit this week`);
    lines.push(`These were dropped by the scheduler. If any belong to you, they are your problem to resolve.`);
    for (const u of openUnplaced) {
      lines.push(`- [${u.domain}] ${u.title}: ${u.detail}`);
    }
  }

  return lines.join("\n");
}

async function coachContext(date: IsoDate): Promise<string> {
  const { sleep, prayer, restrictions, wrestlingPhase } = await loadSettings();

  const weights = await db.select().from(metrics)
    .where(and(eq(metrics.kind, "bodyweight"), gte(metrics.onDate, daysAgo(date, 21))))
    .orderBy(metrics.onDate);

  const sleepHistory: number[] = [];
  for (let i = 1; i <= 7; i++) {
    sleepHistory.push(sleepNightFor(daysAgo(date, i - 1), sleep, prayer).netSleepMin);
  }

  const gate = evaluateGate({
    recentWeights: weights.map((w) => ({ date: w.onDate, lb: w.value })),
    recentNetSleepMin: sleepHistory,
    targetSleepMin: sleep.targetSleepMin,
  });

  const recentLifts = await db.select().from(liftLog)
    .where(gte(liftLog.onDate, daysAgo(date, 14))).orderBy(desc(liftLog.onDate)).limit(60);

  const lines = [`\n## Coach view`];
  lines.push(`Wrestling phase: ${wrestlingPhase}.`);
  lines.push(`Movement restrictions in force: ${restrictions.length > 0 ? restrictions.join(", ") : "none recorded"}.`);

  lines.push(`\n### The volume gate — ALREADY EVALUATED, do not recompute`);
  lines.push(`Verdict: **${gate.verdict}**`);
  lines.push(`Reason: ${gate.reason}`);
  lines.push(`May you add load or volume? **${gate.allowProgression ? "YES" : "NO"}**`);
  if (gate.bodyweightTrendLbPerWeek !== null) {
    lines.push(`Bodyweight trend: ${gate.bodyweightTrendLbPerWeek.toFixed(2)} lb/week`);
  } else {
    lines.push(`Bodyweight trend: not enough weigh-ins logged to measure. Ask him to weigh in.`);
  }

  if (weights.length > 0) {
    const latest = weights[weights.length - 1];
    lines.push(`Latest weigh-in: ${latest?.value} lb on ${latest?.onDate}`);
  } else {
    lines.push(`No bodyweight logged at all yet.`);
  }

  if (recentLifts.length > 0) {
    lines.push(`\n### Recent sets (last 14 days)`);
    const byExercise = new Map<string, typeof recentLifts>();
    for (const l of recentLifts) {
      const list = byExercise.get(l.exerciseName) ?? [];
      list.push(l);
      byExercise.set(l.exerciseName, list);
    }
    for (const [name, sets] of byExercise) {
      const top = sets[0];
      lines.push(`- ${name}: ${sets.length} sets logged, most recent ${top?.weight ?? "bodyweight"} lb x ${top?.reps}`);
    }
  } else {
    lines.push(`\n### No sets logged yet. He is not tracking, which the plan calls the difference between progressing and just exercising.`);
  }

  return lines.join("\n");
}

async function tutorContext(date: IsoDate): Promise<string> {
  const courseRows = await db.select().from(courses).orderBy(courses.period);
  const open = await db.select().from(assignments)
    .where(eq(assignments.status, "open")).orderBy(assignments.dueDate);

  const lines = [`\n## Tutor view`];

  lines.push(`\n### Courses`);
  for (const c of courseRows) {
    lines.push(`- P${c.period} ${c.name}${c.teacher ? ` (${c.teacher})` : ""} — ${c.rigor}, counts toward "${c.domain}"`);
  }

  lines.push(`\n### Open assignments`);
  if (open.length === 0) {
    lines.push(`None recorded. If he mentions one in conversation, emit it as a task.`);
  } else {
    for (const a of open) {
      const course = courseRows.find((c) => c.id === a.courseId);
      const due = a.dueDate ? `due ${a.dueDate}` : "no due date";
      const overdue = a.dueDate && a.dueDate < date ? " — OVERDUE" : "";
      lines.push(`- [${course?.code ?? "?"}] ${a.title} (${a.kind}, ${due}, ~${a.estimatedMin}min)${overdue}`);
    }
  }

  return lines.join("\n");
}

async function ustadhContext(date: IsoDate): Promise<string> {
  const log = await db.select().from(prayerLog)
    .where(gte(prayerLog.onDate, daysAgo(date, 14))).orderBy(desc(prayerLog.onDate));

  const lines = [`\n## Ustadh view`];

  if (log.length === 0) {
    lines.push(`No prayer log entries yet.`);
  } else {
    const counts = { "on-time": 0, late: 0, missed: 0 } as Record<string, number>;
    for (const l of log) counts[l.status] = (counts[l.status] ?? 0) + 1;
    lines.push(`Last 14 days: ${counts["on-time"] ?? 0} on time, ${counts["late"] ?? 0} late, ${counts["missed"] ?? 0} missed.`);

    const byBlock = new Map<string, number>();
    for (const l of log) {
      if (l.status === "missed") byBlock.set(l.block, (byBlock.get(l.block) ?? 0) + 1);
    }
    for (const [block, n] of byBlock) {
      lines.push(`- ${block} missed ${n} times — look at what in his day is causing that.`);
    }
  }

  const quran = await db.select().from(metrics)
    .where(and(eq(metrics.kind, "quran-pages"), gte(metrics.onDate, daysAgo(date, 30))));
  if (quran.length > 0) {
    const total = quran.reduce((s, q) => s + q.value, 0);
    lines.push(`Quran: ${total} pages over the last 30 days.`);
  }

  return lines.join("\n");
}

async function builderContext(date: IsoDate): Promise<string> {
  const projectTasks = await db.select().from(tasks)
    .where(and(inArray(tasks.domain, ["ai", "money"]), eq(tasks.status, "open")));

  const shipped = await db.select().from(tasks)
    .where(and(inArray(tasks.domain, ["ai", "money"]), eq(tasks.status, "done")))
    .orderBy(desc(tasks.createdAt)).limit(10);

  const lines = [`\n## Builder view`];

  lines.push(`\n### Open project work`);
  if (projectTasks.length === 0) {
    lines.push(`Nothing open. That is the problem to solve.`);
  } else {
    for (const t of projectTasks) lines.push(`- [${t.domain}] ${t.title} (${t.durationMin}min, priority ${t.priority})`);
  }

  lines.push(`\n### Recently shipped`);
  if (shipped.length === 0) {
    lines.push(`Nothing shipped yet. Say so plainly.`);
  } else {
    for (const t of shipped) lines.push(`- ${t.title}`);
  }

  const lastShipped = shipped[0];
  if (lastShipped) {
    const days = Math.floor(DateTime.fromISO(date).diff(DateTime.fromJSDate(lastShipped.createdAt), "days").days);
    if (days > 10) lines.push(`\nNothing has shipped in ${days} days. Push on that.`);
  }

  return lines.join("\n");
}

const DOMAIN_CONTEXT: Record<SpecialistName, (date: IsoDate) => Promise<string>> = {
  coach: coachContext,
  tutor: tutorContext,
  ustadh: ustadhContext,
  builder: builderContext,
};

export async function buildContext(agent: SpecialistName, date: IsoDate = today()): Promise<string> {
  const [common, domain] = await Promise.all([commonContext(date), DOMAIN_CONTEXT[agent](date)]);
  return `${common}\n${domain}`;
}

/** Count of open tasks per domain — cheap enough for a dashboard. */
export async function domainCounts(): Promise<Record<string, number>> {
  const rows = await db
    .select({ domain: tasks.domain, n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(eq(tasks.status, "open"))
    .groupBy(tasks.domain);
  return Object.fromEntries(rows.map((r) => [r.domain, r.n]));
}

export { toHm };
