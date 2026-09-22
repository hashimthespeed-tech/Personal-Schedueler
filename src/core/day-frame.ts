import { DateTime } from "luxon";
import { type DayTemplate, type PlanBlock } from "./adaptive";
import { fixedCommitmentsFor, homeTimeFor, TERM_S1 } from "../data/school";

export type SleepMode = "current" | "target";

export interface DayFrameOptions {
  sleepMode: SleepMode;
  extraBlocks?: PlanBlock[];
  /** Arrival time is kept open for prayer and a shower, in either order. */
  afterSchoolPrayerMin?: number;
}

const SLEEP_TIMES: Record<SleepMode, Pick<DayTemplate, "wake" | "bedtime" | "nextWake">> = {
  current: { wake: 7 * 60 + 30, bedtime: 23 * 60 + 30, nextWake: 7 * 60 + 30 },
  target: { wake: 6 * 60, bedtime: 22 * 60, nextWake: 6 * 60 },
};

/** Construct one date's non-negotiable frame without mutating any saved plan. */
export function buildDayFrame(date: string, options: DayFrameOptions): DayTemplate {
  const localDate = DateTime.fromISO(date);
  if (!localDate.isValid || localDate.toISODate() !== date) {
    throw new Error("A valid ISO date is required.");
  }

  const blocks: PlanBlock[] = [];
  const schoolDay = date >= TERM_S1.start && date <= TERM_S1.end && localDate.weekday <= 5;
  if (schoolDay) {
    for (const commitment of fixedCommitmentsFor(localDate.weekday)) {
      blocks.push(commitment.workable
        ? {
            id: commitment.id,
            title: commitment.title,
            start: commitment.start,
            end: commitment.end,
            policy: "flexible",
            cost: "friend",
            canUseFor: "school",
          }
        : {
            id: commitment.id,
            title: commitment.title,
            start: commitment.start,
            end: commitment.end,
            policy: "fixed",
          });
    }

    const home = homeTimeFor(localDate.weekday);
    const duration = options.afterSchoolPrayerMin ?? 45;
    if (home !== null && duration > 0) {
      blocks.push({
        id: "after-school-prayer",
        title: "Prayer and shower",
        start: home,
        end: home + duration,
        policy: "protected",
      });
    }
  }

  blocks.push(...(options.extraBlocks ?? []));
  blocks.sort((a, b) => a.start - b.start || a.end - b.end);
  return { date, ...SLEEP_TIMES[options.sleepMode], blocks };
}
