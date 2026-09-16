/**
 * Sleep model.
 *
 * The user wakes for Fajr and returns to sleep, with a fixed 06:00 anchor set
 * by school. So there are two distinct "wake" concepts and conflating them
 * produces wrong sleep totals:
 *
 *   dayStart  — 06:00, fixed. When the schedulable day begins.
 *   fajrWake  — computed daily. A brief interruption, then back to sleep.
 *
 * Because school pins dayStart, bedtime is the only variable that can repay
 * sleep debt. It ramps earlier 15 min/week and the solver treats it as a hard
 * wall — nothing is scheduled past it.
 *
 * Seasonal behaviour falls out of this for free: once Fajr drifts later than
 * dayStart (San Diego, roughly late November through early January) the
 * interruption is zero and Fajr simply becomes the start of the morning.
 */

import { DateTime } from "luxon";
import type { IsoDate, MinuteOfDay } from "./types";
import { rawPrayerTimes, type PrayerConfig, LA_MESA } from "./prayer";

export interface SleepModel {
  /** fixed schedulable-day start, minutes since midnight */
  dayStart: MinuteOfDay;
  /** minutes for wudhu + Fajr before returning to sleep */
  fajrInterruptionMin: number;
  returnToSleep: boolean;
  /** net sleep goal in minutes, excluding the Fajr interruption */
  targetSleepMin: number;
  /** where the ramp starts */
  startBedtime: MinuteOfDay;
  /** where the ramp ends */
  goalBedtime: MinuteOfDay;
  rampMinutesPerWeek: number;
  /** date the ramp began */
  rampStartDate: IsoDate;
}

export const DEFAULT_SLEEP: SleepModel = {
  dayStart: 6 * 60, // 06:00
  fajrInterruptionMin: 20,
  returnToSleep: true,
  targetSleepMin: 8 * 60, // 8h net
  startBedtime: 23 * 60, // 23:00 — where the user is today
  goalBedtime: 21 * 60 + 40, // 21:40 — 6:00 minus 8h minus the 20min interruption
  rampMinutesPerWeek: 15,
  rampStartDate: "2026-09-15",
};

/** Whole weeks elapsed since the ramp began. Never negative. */
export function weeksIntoRamp(date: IsoDate, model: SleepModel = DEFAULT_SLEEP): number {
  const start = DateTime.fromISO(model.rampStartDate);
  const now = DateTime.fromISO(date);
  const days = Math.floor(now.diff(start, "days").days);
  return Math.max(0, Math.floor(days / 7));
}

/**
 * The bedtime in force on `date`. Walks from startBedtime toward goalBedtime
 * and stops there — it never overshoots into an even earlier bedtime.
 */
export function bedtimeFor(date: IsoDate, model: SleepModel = DEFAULT_SLEEP): MinuteOfDay {
  const weeks = weeksIntoRamp(date, model);
  const shifted = model.startBedtime - weeks * model.rampMinutesPerWeek;
  return Math.max(model.goalBedtime, shifted);
}

/**
 * Minutes of sleep actually lost to Fajr on `date`.
 *
 * `prayed` is not optional and defaults to false, because charging the
 * interruption unconditionally turns a measurement into a guess: it assumed a
 * wake that may never have happened, and then the coach's gate acted on the
 * result. The cost is only real once Fajr is marked.
 *
 * Also zero when Fajr lands at or after dayStart — he is up anyway — and zero
 * if he does not go back to sleep.
 */
export function fajrInterruptionFor(
  date: IsoDate,
  prayed = false,
  model: SleepModel = DEFAULT_SLEEP,
  config: PrayerConfig = LA_MESA,
): number {
  if (!prayed) return 0;
  if (!model.returnToSleep) return 0;
  const { fajr } = rawPrayerTimes(date, config);
  if (fajr >= model.dayStart) return 0;
  return model.fajrInterruptionMin;
}

export interface SleepNight {
  /** the date being woken into */
  date: IsoDate;
  /** bedtime the previous evening */
  bedtime: MinuteOfDay;
  dayStart: MinuteOfDay;
  fajr: MinuteOfDay;
  /** minutes lost to the Fajr wake, 0 when Fajr is after dayStart */
  interruptionMin: number;
  /** time in bed minus the interruption */
  netSleepMin: number;
  /** netSleepMin minus targetSleepMin; negative means short */
  vsTargetMin: number;
  /** true when Fajr falls inside the schedulable day rather than during sleep */
  fajrAfterDayStart: boolean;
}

/** What the night before `date` looks like under the model. */
export function sleepNightFor(
  date: IsoDate,
  prayedFajr = false,
  model: SleepModel = DEFAULT_SLEEP,
  config: PrayerConfig = LA_MESA,
): SleepNight {
  const prevDate = DateTime.fromISO(date).minus({ days: 1 }).toISODate();
  if (!prevDate) throw new Error(`Cannot rewind date: ${date}`);

  const bedtime = bedtimeFor(prevDate, model);
  const { fajr } = rawPrayerTimes(date, config);
  const interruptionMin = fajrInterruptionFor(date, prayedFajr, model, config);

  // bedtime is on the previous evening, dayStart the next morning
  const timeInBed = 1440 - bedtime + model.dayStart;
  const netSleepMin = timeInBed - interruptionMin;

  return {
    date,
    bedtime,
    dayStart: model.dayStart,
    fajr,
    interruptionMin,
    netSleepMin,
    vsTargetMin: netSleepMin - model.targetSleepMin,
    fajrAfterDayStart: fajr >= model.dayStart,
  };
}

/**
 * The schedulable envelope for `date`: dayStart until that evening's bedtime.
 * The solver never places anything outside this.
 */
export function dayEnvelope(
  date: IsoDate,
  model: SleepModel = DEFAULT_SLEEP,
): { start: MinuteOfDay; end: MinuteOfDay } {
  return { start: model.dayStart, end: bedtimeFor(date, model) };
}
