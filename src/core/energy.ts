/**
 * Energy model.
 *
 * Seeded from the user's known shape, then corrected from check-in history
 * once there is any (see `learnedEnergyCurve`).
 *
 * The important asymmetry: the 06:00-08:05 pre-school window is the only
 * uninterrupted high-energy stretch of a weekday, roughly 9 hours a week.
 * Homework expands to fill whatever it is given, so it belongs in the
 * degraded evening slots and project work belongs in the morning.
 */

import type { Energy, MinuteOfDay } from "./types.js";
import { hm } from "./types.js";
import { PRACTICE_DAYS } from "../data/school.js";

const RANK: Record<Energy, number> = { low: 0, med: 1, high: 2 };

export function energyRank(e: Energy): number {
  return RANK[e];
}

/** True when a slot is good enough for a task that asked for `required`. */
export function energySatisfies(slot: Energy, required: Energy): boolean {
  return RANK[slot] >= RANK[required];
}

export interface EnergyOverride {
  weekday: number;
  start: MinuteOfDay;
  end: MinuteOfDay;
  energy: Energy;
}

/**
 * Energy for a point in time.
 *
 * Weekday shape:
 *   06:00-08:05  high   pre-school, uninterrupted
 *   at school    med    period 7 only; he has been in class all day
 *   home-19:00   med    non-practice days
 *   post-practice low   Tue/Thu after 17:30, he is cooked
 *   19:00-20:30  med
 *   last hour    low    winding down toward the bedtime wall
 */
export function energyAt(
  weekday: number,
  minute: MinuteOfDay,
  bedtime: MinuteOfDay,
  overrides: EnergyOverride[] = [],
): Energy {
  for (const o of overrides) {
    if (o.weekday === weekday && minute >= o.start && minute < o.end) return o.energy;
  }

  const isWeekend = weekday > 5;
  const isPracticeDay = PRACTICE_DAYS.includes(weekday);

  // the final hour before the bedtime wall is never good work time
  if (minute >= bedtime - 60) return "low";

  if (isWeekend) {
    if (minute < hm("12:00")) return "high";
    if (minute < hm("17:00")) return "med";
    return "low";
  }

  // pre-school morning block
  if (minute < hm("08:05")) return "high";

  // at school
  if (minute < hm("15:36")) return "med";

  // Tue/Thu: practice drains the evening
  if (isPracticeDay) return "low";

  if (minute < hm("19:00")) return "med";
  if (minute < hm("20:30")) return "med";
  return "low";
}

/**
 * Rebuild the weekday overrides from logged check-ins.
 *
 * Each check-in reports an energy score 1-5 and which blocks slipped. A block
 * that repeatedly slips in the same weekday/time band is evidence the seeded
 * curve is too optimistic there.
 */
export interface SlipObservation {
  weekday: number;
  start: MinuteOfDay;
  end: MinuteOfDay;
  slipped: boolean;
}

export function learnedEnergyCurve(
  observations: SlipObservation[],
  minSamples = 4,
  slipThreshold = 0.5,
): EnergyOverride[] {
  const buckets = new Map<string, { weekday: number; start: MinuteOfDay; end: MinuteOfDay; total: number; slipped: number }>();

  for (const o of observations) {
    // bucket to the hour so separate blocks in the same band aggregate
    const hourStart = Math.floor(o.start / 60) * 60;
    const key = `${o.weekday}:${hourStart}`;
    const b = buckets.get(key) ?? { weekday: o.weekday, start: hourStart, end: hourStart + 60, total: 0, slipped: 0 };
    b.total += 1;
    if (o.slipped) b.slipped += 1;
    buckets.set(key, b);
  }

  const out: EnergyOverride[] = [];
  for (const b of buckets.values()) {
    if (b.total < minSamples) continue;
    if (b.slipped / b.total >= slipThreshold) {
      out.push({ weekday: b.weekday, start: b.start, end: b.end, energy: "low" });
    }
  }
  return out;
}
