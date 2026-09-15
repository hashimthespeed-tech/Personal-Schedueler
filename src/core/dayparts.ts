/**
 * Resolving a day part to a concrete window.
 *
 * Derived per-date rather than fixed, so the windows follow the bedtime ramp
 * and the difference between a school day, a practice day and a weekend.
 */

import type { DayPart, MinuteOfDay, TimeRange } from "./types";
import { hm } from "./types";
import { bedtimeFor, type SleepModel, DEFAULT_SLEEP } from "./sleep";
import { homeTimeFor, PRACTICE_DAYS } from "../data/school";

export function resolveDayPart(
  part: DayPart,
  date: string,
  weekday: number,
  sleep: SleepModel = DEFAULT_SLEEP,
): TimeRange | null {
  if (part === "anytime") return null;

  const bedtime = bedtimeFor(date, sleep);
  const dayStart = sleep.dayStart;
  const isWeekend = weekday > 5;
  const home: MinuteOfDay = homeTimeFor(weekday) ?? hm("12:00");

  switch (part) {
    case "morning":
      // weekdays this is the pre-school block; weekends it runs longer
      return isWeekend
        ? { start: dayStart, end: hm("11:00") }
        : { start: dayStart, end: hm("08:05") };

    case "midday":
      return isWeekend ? { start: hm("11:00"), end: hm("14:30") } : { start: hm("11:00"), end: hm("13:30") };

    case "after-school":
      // on a practice day he is not home until 17:30, so this shifts with it
      return isWeekend
        ? { start: hm("14:00"), end: hm("17:30") }
        : { start: home, end: Math.max(home + 120, hm("18:30")) };

    case "evening":
      return { start: isWeekend ? hm("17:30") : Math.max(home, hm("18:00")), end: bedtime - 30 };

    case "bedtime":
      // the 90 minutes before the wall, which is where a wind-down belongs
      return { start: bedtime - 90, end: bedtime };
  }
}

/** True when a day part exists at all on this weekday. */
export function dayPartApplies(part: DayPart, weekday: number): boolean {
  if (part === "after-school" && weekday > 5) return true;
  if (part === "anytime") return true;
  // a practice day has no usable after-school window before 17:30, but
  // resolveDayPart already shifts it, so every part applies every day
  void PRACTICE_DAYS;
  return true;
}
