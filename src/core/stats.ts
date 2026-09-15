/**
 * Statistics derived from what actually happened.
 *
 * Everything here reads `completions`, never `blocks`. Blocks are replaced
 * wholesale on every replan — they are a projection of the future, not a
 * record of the past. Measuring consistency against a table that gets deleted
 * nightly would quietly report nonsense.
 */

import { DateTime } from "luxon";
import type { Domain, IsoDate } from "./types";

export interface CompletionRecord {
  onDate: IsoDate;
  domain: string;
  goalId: number | null;
  minutes: number;
  skipped: boolean;
  completedAt: Date;
  plannedStartMin: number | null;
}

export interface DomainStat {
  domain: string;
  done: number;
  skipped: number;
  minutes: number;
  /** done / (done + skipped), or null when nothing was scheduled */
  consistency: number | null;
  /** consecutive days ending today with at least one completion */
  streak: number;
}

export interface GoalStat {
  goalId: number;
  done: number;
  minutes: number;
  weeklyTarget: number | null;
  /** progress toward the weekly target, 0..1, null when no target is set */
  progress: number | null;
}

export function datesInRange(end: IsoDate, days: number): IsoDate[] {
  const out: IsoDate[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = DateTime.fromISO(end).minus({ days: i }).toISODate();
    if (d) out.push(d);
  }
  return out;
}

/** Consecutive days ending at `end` with at least one non-skipped completion. */
export function streakFor(records: CompletionRecord[], end: IsoDate): number {
  const done = new Set(records.filter((r) => !r.skipped).map((r) => r.onDate));
  let streak = 0;
  let cursor = DateTime.fromISO(end);

  // today not being logged yet should not break a streak, so start from
  // yesterday when today is empty
  const todayIso = cursor.toISODate();
  if (todayIso && !done.has(todayIso)) cursor = cursor.minus({ days: 1 });

  for (;;) {
    const iso = cursor.toISODate();
    if (!iso || !done.has(iso)) break;
    streak += 1;
    cursor = cursor.minus({ days: 1 });
  }
  return streak;
}

export function statsByDomain(records: CompletionRecord[], end: IsoDate): DomainStat[] {
  const byDomain = new Map<string, CompletionRecord[]>();
  for (const r of records) {
    const list = byDomain.get(r.domain) ?? [];
    list.push(r);
    byDomain.set(r.domain, list);
  }

  return [...byDomain.entries()]
    .map(([domain, list]) => {
      const done = list.filter((r) => !r.skipped).length;
      const skipped = list.filter((r) => r.skipped).length;
      const total = done + skipped;
      return {
        domain,
        done,
        skipped,
        minutes: list.filter((r) => !r.skipped).reduce((n, r) => n + r.minutes, 0),
        consistency: total === 0 ? null : done / total,
        streak: streakFor(list, end),
      };
    })
    .sort((a, b) => b.done - a.done);
}

export function statsByGoal(
  records: CompletionRecord[],
  goals: { id: number; weeklyTarget: number | null }[],
  weeks: number,
): GoalStat[] {
  return goals.map((g) => {
    const mine = records.filter((r) => r.goalId === g.id && !r.skipped);
    const perWeek = weeks > 0 ? mine.length / weeks : 0;
    return {
      goalId: g.id,
      done: mine.length,
      minutes: mine.reduce((n, r) => n + r.minutes, 0),
      weeklyTarget: g.weeklyTarget,
      progress: g.weeklyTarget ? Math.min(1, perWeek / g.weeklyTarget) : null,
    };
  });
}

/**
 * One number for "how did the month go".
 *
 * The mean of each domain's consistency, not of all completions pooled —
 * otherwise a domain with many small tasks drowns out one with a few large
 * ones, and showing up for four lifts would count for less than four
 * weigh-ins.
 */
export function overallScore(stats: DomainStat[]): number | null {
  const measured = stats.filter((s) => s.consistency !== null);
  if (measured.length === 0) return null;
  const sum = measured.reduce((n, s) => n + (s.consistency ?? 0), 0);
  return sum / measured.length;
}

/** Completions per day, for a bar or line chart. */
export function dailyCounts(
  records: CompletionRecord[],
  end: IsoDate,
  days: number,
): { date: IsoDate; done: number; skipped: number }[] {
  return datesInRange(end, days).map((date) => {
    const onDay = records.filter((r) => r.onDate === date);
    return {
      date,
      done: onDay.filter((r) => !r.skipped).length,
      skipped: onDay.filter((r) => r.skipped).length,
    };
  });
}

/** How late a completion was against its plan, in minutes. Negative is early. */
export function latenessMinutes(record: CompletionRecord, timezone: string): number | null {
  if (record.plannedStartMin === null) return null;
  const at = DateTime.fromJSDate(record.completedAt, { zone: timezone });
  return at.hour * 60 + at.minute - record.plannedStartMin;
}

export const DOMAIN_ORDER: Domain[] = ["school", "deen", "ai", "money", "physique"];
