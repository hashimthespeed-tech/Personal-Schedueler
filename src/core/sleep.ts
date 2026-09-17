/**
 * Sleep.
 *
 * This used to be a ramp: bedtime walked from 23:00 toward 21:40 at fifteen
 * minutes a week, and a Fajr wake was deducted from every night. Both belonged
 * to the solver, which needed a bedtime it could compute. The routine fixes
 * lights out at 22:00, so a second, drifting bedtime living here only meant
 * Settings and Today disagreed about what time he goes to bed.
 *
 * The Fajr deduction went with it, for a harder reason: it assumed he wakes at
 * Fajr and goes back to sleep. He does not. Fajr enters before 06:00 every day
 * of the year here, but its window stays open until sunrise, and sunrise is
 * after 06:00 from August until the second of May — so he prays when he gets
 * up, once, and there is nothing to deduct. After that the alarm beats sunrise
 * and the last six weeks of school need an earlier wake; `routine.wake` is a
 * config field for exactly that. The sleep tests are the evidence for all of it.
 *
 * What is left is the part a function cannot derive: what he actually slept.
 */

import type { MinuteOfDay } from "./types";

export interface SleepModel {
  /** fixed wake, minutes since midnight — school pins it */
  dayStart: MinuteOfDay;
  /** net sleep goal in minutes */
  targetSleepMin: number;
}

export const DEFAULT_SLEEP: SleepModel = {
  dayStart: 6 * 60, // 06:00
  targetSleepMin: 8 * 60, // 8h
};

/**
 * Sleep between two clock times, where bedtime is the evening before.
 * Wraps past midnight, so 23:10 -> 06:00 is 410 minutes and not -1030.
 */
export function netSleepFrom(bedtimeMin: number, wakeMin: number): number {
  const raw = wakeMin - bedtimeMin;
  return raw > 0 ? raw : raw + 1440;
}
