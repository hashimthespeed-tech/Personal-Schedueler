/**
 * Consistency, which is the whole point of a fixed routine.
 *
 * The old system could not produce this number. Blocks moved every night, so
 * "you missed Tuesday's lift" was ambiguous — missed the block, or the block
 * was never placed? With the same slots every day, a miss is a miss and the
 * arithmetic is honest.
 *
 * Pure. Takes rows, returns numbers.
 */

import { DateTime } from "luxon";
import type { IsoDate } from "./types";
import { dayFor, isMealSlot, trackedSlots, type DayOptions } from "./routine";

export type SlotStatus = "done" | "missed";

export interface LogRow {
  onDate: IsoDate;
  slotKey: string;
  status: SlotStatus;
  /** 1-10, or null when he skipped the second tap */
  intensity?: number | null;
  /** optional meal calories */
  calories?: number | null;
}

export interface SlotScore {
  key: string;
  label: string;
  /** days in the window where this slot existed */
  scheduled: number;
  done: number;
  missed: number;
  /** unanswered — neither ticked nor crossed */
  silent: number;
  /** done / scheduled, 0..1 */
  rate: number;
  /** mean of the ratings he gave, or null if he never rated this one */
  avgIntensity: number | null;
  domain: string | null;
  kind: string;
}

/** One cell of the day-by-slot grid: what happened, and how hard. */
export interface Cell {
  date: IsoDate;
  slotKey: string;
  status: SlotStatus | null;
  intensity: number | null;
}

export interface DailyCalories {
  date: IsoDate;
  /** null means the food log is incomplete — chart this as a gap */
  calories: number | null;
}

export interface Consistency {
  from: IsoDate;
  to: IsoDate;
  days: number;
  slots: SlotScore[];
  /** across every tracked slot in the window */
  overall: number;
  /** the four core hours only, which is the number that matters */
  core: number;
  /** longest run of days where every core hour was done */
  bestStreak: number;
  currentStreak: number;
  /** every tracked slot on every day in the window, for the grid */
  grid: Cell[];
  /** the dates the grid spans, in order */
  dates: IsoDate[];
  /** mean rating across everything he rated, or null */
  avgIntensity: number | null;
  /** one honest total per day, or null when any meal is incomplete */
  dailyCalories: DailyCalories[];
}

function datesBetween(from: IsoDate, to: IsoDate): IsoDate[] {
  const start = DateTime.fromISO(from);
  const end = DateTime.fromISO(to);
  const out: IsoDate[] = [];
  for (let d = start; d <= end; d = d.plus({ days: 1 })) {
    const iso = d.toISODate();
    if (iso) out.push(iso);
  }
  return out;
}

/**
 * Score a window.
 *
 * Two decisions worth knowing about.
 *
 * The rate is done over scheduled, so a day he never answered counts against
 * him. The alternative — scoring only the days he replied — flatters: it can
 * read 100% on a week he barely showed up. But unanswered days are reported
 * separately as `silent`, so a low score can be read as "did not answer"
 * rather than "failed", which are different things.
 *
 * And the window never starts before the first day he logged anything. Asking
 * for a fortnight on his second day used to count twelve days of pre-history as
 * misses and report 8%, which is arithmetically true and completely useless.
 */
export function consistency(
  from: IsoDate,
  to: IsoDate,
  rows: LogRow[],
  options: DayOptions = {},
): Consistency {
  const firstLogged = rows.reduce<IsoDate | null>(
    (earliest, r) => (earliest === null || r.onDate < earliest ? r.onDate : earliest),
    null,
  );
  const start = firstLogged && firstLogged > from ? firstLogged : from;
  const dates = datesBetween(start, to);
  const byDate = new Map<IsoDate, Map<string, { status: SlotStatus; intensity: number | null; calories: number | null }>>();

  for (const row of rows) {
    const day = byDate.get(row.onDate) ?? new Map<string, { status: SlotStatus; intensity: number | null; calories: number | null }>();
    day.set(row.slotKey, { status: row.status, intensity: row.intensity ?? null, calories: row.calories ?? null });
    byDate.set(row.onDate, day);
  }

  const totals = new Map<
    string,
    { label: string; domain: string | null; kind: string; scheduled: number; done: number; missed: number; ratings: number[] }
  >();
  const grid: Cell[] = [];
  const coreKeysSeen = new Set<string>();
  let coreDone = 0;
  let coreScheduled = 0;

  const fullDays: boolean[] = [];
  const dailyCalories: DailyCalories[] = [];

  for (const date of dates) {
    const day = dayFor(date, options);
    const logged = byDate.get(date);
    let dayCoreTotal = 0;
    let dayCoreDone = 0;

    for (const slot of trackedSlots(day)) {
      const entry = totals.get(slot.key) ?? {
        label: slot.label,
        domain: slot.domain ?? null,
        kind: slot.kind,
        scheduled: 0,
        done: 0,
        missed: 0,
        ratings: [],
      };
      entry.scheduled += 1;

      const mark = logged?.get(slot.key);
      const status = mark?.status;
      if (status === "done") entry.done += 1;
      else if (status === "missed") entry.missed += 1;
      if (mark?.intensity != null) entry.ratings.push(mark.intensity);

      grid.push({
        date,
        slotKey: slot.key,
        status: status ?? null,
        intensity: mark?.intensity ?? null,
      });

      totals.set(slot.key, entry);

      if (slot.kind === "core") {
        coreKeysSeen.add(slot.key);
        coreScheduled += 1;
        dayCoreTotal += 1;
        if (status === "done") {
          coreDone += 1;
          dayCoreDone += 1;
        }
      }
    }

    fullDays.push(dayCoreTotal > 0 && dayCoreDone === dayCoreTotal);

    let totalCalories = 0;
    let caloriesComplete = true;
    for (const meal of day.slots.filter(isMealSlot)) {
      const mealMark = logged?.get(meal.key);
      if (!mealMark || (mealMark.status === "done" && mealMark.calories === null)) {
        caloriesComplete = false;
        break;
      }
      if (mealMark.status === "done") totalCalories += mealMark.calories;
    }
    dailyCalories.push({ date, calories: caloriesComplete ? totalCalories : null });
  }

  const slots: SlotScore[] = [...totals.entries()].map(([key, v]) => ({
    key,
    label: v.label,
    domain: v.domain,
    kind: v.kind,
    scheduled: v.scheduled,
    done: v.done,
    missed: v.missed,
    silent: v.scheduled - v.done - v.missed,
    rate: v.scheduled === 0 ? 0 : v.done / v.scheduled,
    avgIntensity:
      v.ratings.length === 0 ? null : v.ratings.reduce((a, b) => a + b, 0) / v.ratings.length,
  }));

  const allRatings = [...totals.values()].flatMap((v) => v.ratings);

  const scheduledAll = slots.reduce((n, s) => n + s.scheduled, 0);
  const doneAll = slots.reduce((n, s) => n + s.done, 0);

  let best = 0;
  let run = 0;
  for (const complete of fullDays) {
    run = complete ? run + 1 : 0;
    if (run > best) best = run;
  }

  let current = 0;
  for (let i = fullDays.length - 1; i >= 0 && fullDays[i]; i--) current += 1;

  return {
    from: start,
    to,
    days: dates.length,
    slots,
    overall: scheduledAll === 0 ? 0 : doneAll / scheduledAll,
    core: coreScheduled === 0 ? 0 : coreDone / coreScheduled,
    bestStreak: best,
    currentStreak: current,
    grid,
    dates,
    avgIntensity:
      allRatings.length === 0 ? null : allRatings.reduce((a, b) => a + b, 0) / allRatings.length,
    dailyCalories,
  };
}

/** The last `days` days ending today, inclusive. */
export function windowEnding(date: IsoDate, days: number): { from: IsoDate; to: IsoDate } {
  const to = date;
  const from = DateTime.fromISO(date).minus({ days: days - 1 }).toISODate();
  if (!from) throw new Error(`Cannot rewind ${days} days from ${date}`);
  return { from, to };
}
