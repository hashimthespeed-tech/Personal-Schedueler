import { DateTime } from "luxon";
import { type DayTemplate, type PlanBlock } from "./adaptive";
import { fixedCommitmentsFor, homeTimeFor, PRACTICE_DAYS, TERM_S1 } from "../data/school";
import { recurringCommitmentsFor } from "./recurring-commitments";
import { hm } from "./types";

export type SleepMode = "current" | "target";

export interface DayFrameOptions {
  sleepMode: SleepMode;
  extraBlocks?: PlanBlock[];
  /** Include optional routines only so a proposal can name their exact cost. */
  includeRoutineTradeoffs?: boolean;
}

const SLEEP_TIMES: Record<SleepMode, Pick<DayTemplate, "wake" | "workCutoff" | "bedtime" | "emergencyEnd" | "nextWake">> = {
  current: { wake: hm("06:00"), workCutoff: hm("21:00"), bedtime: hm("22:00"), emergencyEnd: hm("22:45"), nextWake: hm("06:00") },
  target: { wake: hm("06:00"), workCutoff: hm("21:00"), bedtime: hm("22:00"), emergencyEnd: hm("22:45"), nextWake: hm("06:00") },
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
    const commitments = fixedCommitmentsFor(localDate.weekday);
    const commute = commitments.find((commitment) => commitment.id.endsWith("commute-am"));
    if (commute && commute.start > hm("07:40")) {
      blocks.push({ id: "morning-prep", title: "Morning preparation", start: hm("07:40"),
        end: commute.start, policy: "protected" });
    }
    for (const commitment of commitments) {
      if (commitment.kind === "practice") continue;
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
    if (home !== null) {
      const duration = PRACTICE_DAYS.includes(localDate.weekday) ? 45 : 30;
      blocks.push({
        id: "arrival-buffer",
        title: "Arrival, meal, and shower",
        start: home,
        end: home + duration,
        policy: "protected",
      });
    }

    if (options.includeRoutineTradeoffs && home !== null) {
      blocks.push({ id: "personal-focus", title: "Personal goal time", start: 20 * 60, end: 21 * 60,
        policy: "flexible", minMinutes: 40, cost: "routine" });
    }
  }

  for (const recurring of recurringCommitmentsFor(date)) {
    blocks.push({
      id: `recurring-${recurring.slotKey}`,
      title: recurring.title,
      start: recurring.start,
      end: recurring.end,
      policy: recurring.plannerPolicy,
      ...(recurring.kind === "workout" ? { minMinutes: 0, cost: "routine" as const } : {}),
    });
  }

  blocks.push({
    id: "wind-down",
    title: "Before-sleep time",
    start: hm("21:00"),
    end: hm("22:00"),
    policy: "flexible",
    minMinutes: 0,
    cost: "winddown",
    canUseFor: "school",
  });

  blocks.push(...(options.extraBlocks ?? []));
  blocks.sort((a, b) => a.start - b.start || a.end - b.end);
  return { date, ...SLEEP_TIMES[options.sleepMode], blocks };
}
