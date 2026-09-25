import { DateTime } from "luxon";
import { fixedCommitmentsFor, homeTimeFor, PRACTICE_DAYS, TERM_S1 } from "../data/school";
import { prayerBlocks } from "./prayer";
import { hm, type IsoDate, type MinuteOfDay } from "./types";

export type RecurringKind = "prayer" | "wrestling" | "workout";
export type RecurringPlannerPolicy = "protected" | "fixed" | "flexible";

export interface RecurringCommitment {
  slotKey: string;
  title: string;
  start: MinuteOfDay;
  end: MinuteOfDay;
  kind: RecurringKind;
  plannerPolicy: RecurringPlannerPolicy;
}

const PRAYER_DURATION_MIN = 12;
const WORKOUT_DAYS = new Set([1, 5, 6, 7]);

function validDate(date: string): DateTime {
  const parsed = DateTime.fromISO(date);
  if (!parsed.isValid || parsed.toISODate() !== date) {
    throw new Error("A valid ISO date is required.");
  }
  return parsed;
}

function isSchoolDay(date: IsoDate, weekday: number): boolean {
  return weekday <= 5 && date >= TERM_S1.start && date <= TERM_S1.end;
}

function dhuhrStart(date: IsoDate, weekday: number): MinuteOfDay {
  if (isSchoolDay(date, weekday)) {
    const home = homeTimeFor(weekday);
    if (home !== null) return home + (PRACTICE_DAYS.includes(weekday) ? 45 : 30);
  }

  const calculated = prayerBlocks(date).find((block) => block.name === "dhuhr-asr");
  if (!calculated) throw new Error(`No Dhuhr + Asr calculation for ${date}.`);
  return calculated.start;
}

/**
 * The single deterministic source for visible recurring commitments.
 * Nothing returned here is stored as a daily scheduled-task row.
 */
export function recurringCommitmentsFor(date: IsoDate): RecurringCommitment[] {
  const parsed = validDate(date);
  const weekday = parsed.weekday;
  const dhuhr = dhuhrStart(date, weekday);
  const items: RecurringCommitment[] = [
    {
      slotKey: "fajr",
      title: "Fajr",
      start: hm("06:05"),
      end: hm("06:17"),
      kind: "prayer",
      plannerPolicy: "protected",
    },
    {
      slotKey: "dhuhr-asr",
      title: "Dhuhr + Asr",
      start: dhuhr,
      end: dhuhr + PRAYER_DURATION_MIN,
      kind: "prayer",
      plannerPolicy: "protected",
    },
    {
      slotKey: "maghrib-isha",
      title: "Maghrib + Isha",
      start: hm("19:00"),
      end: hm("19:12"),
      kind: "prayer",
      plannerPolicy: "protected",
    },
  ];

  if (isSchoolDay(date, weekday) && PRACTICE_DAYS.includes(weekday)) {
    const practice = fixedCommitmentsFor(weekday).find((item) => item.kind === "practice");
    if (practice) {
      items.push({
        slotKey: "wrestling",
        title: "Wrestling",
        start: practice.start,
        end: practice.end,
        kind: "wrestling",
        plannerPolicy: "fixed",
      });
    }
  }

  if (WORKOUT_DAYS.has(weekday)) {
    items.push({
      slotKey: "workout",
      title: "Workout",
      start: hm("17:30"),
      end: hm("18:00"),
      kind: "workout",
      plannerPolicy: "flexible",
    });
  }

  return items.sort((a, b) => a.start - b.start || a.end - b.end || a.slotKey.localeCompare(b.slotKey));
}

export function recurringCommitmentFor(date: IsoDate, slotKey: string): RecurringCommitment | null {
  return recurringCommitmentsFor(date).find((item) => item.slotKey === slotKey) ?? null;
}
