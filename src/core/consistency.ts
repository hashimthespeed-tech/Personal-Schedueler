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
import { dayFor, trackedSlots, type DayOptions } from "./routine";

export type SlotStatus = "done" | "missed";

export interface LogRow {
  onDate: IsoDate;
  slotKey: string;
  status: SlotStatus;
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
  const byDate = new Map<IsoDate, Map<string, SlotStatus>>();

  for (const row of rows) {
    const day = byDate.get(row.onDate) ?? new Map<string, SlotStatus>();
    day.set(row.slotKey, row.status);
    byDate.set(row.onDate, day);
  }

  const totals = new Map<string, { label: string; scheduled: number; done: number; missed: number }>();
  const coreKeysSeen = new Set<string>();
  let coreDone = 0;
  let coreScheduled = 0;

  const fullDays: boolean[] = [];

  for (const date of dates) {
    const day = dayFor(date, options);
    const logged = byDate.get(date);
    let dayCoreTotal = 0;
    let dayCoreDone = 0;

    for (const slot of trackedSlots(day)) {
      const entry = totals.get(slot.key) ?? {
        label: slot.label,
        scheduled: 0,
        done: 0,
        missed: 0,
      };
      entry.scheduled += 1;

      const status = logged?.get(slot.key);
      if (status === "done") entry.done += 1;
      else if (status === "missed") entry.missed += 1;

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
  }

  const slots: SlotScore[] = [...totals.entries()].map(([key, v]) => ({
    key,
    label: v.label,
    scheduled: v.scheduled,
    done: v.done,
    missed: v.missed,
    silent: v.scheduled - v.done - v.missed,
    rate: v.scheduled === 0 ? 0 : v.done / v.scheduled,
  }));

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
  };
}

/** The last `days` days ending today, inclusive. */
export function windowEnding(date: IsoDate, days: number): { from: IsoDate; to: IsoDate } {
  const to = date;
  const from = DateTime.fromISO(date).minus({ days: days - 1 }).toISODate();
  if (!from) throw new Error(`Cannot rewind ${days} days from ${date}`);
  return { from, to };
}
