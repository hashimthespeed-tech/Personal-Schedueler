/**
 * Free-slot construction.
 *
 * Takes a date range down to the contiguous stretches of time that are
 * actually available, after the bedtime wall, school, practice, commute,
 * meals and prayer are removed.
 */

import { DateTime } from "luxon";
import type { FixedCommitment, IsoDate, MinuteOfDay, Slot, TimeRange } from "./types";
import { subtractRanges, hm } from "./types";
import { dayEnvelope, type SleepModel, DEFAULT_SLEEP } from "./sleep";
import { prayerBlocks, type PrayerConfig, LA_MESA } from "./prayer";
import { energyAt, type EnergyOverride } from "./energy";
import { fixedCommitmentsFor, homeTimeFor } from "../data/school";

/**
 * Arriving home: decompress and eat. The training plan calls for two full
 * plates immediately after school, so this is a real meal, not a pause.
 */
export const SETTLE_MIN = 30;

/**
 * Daily overhead that is neither school nor schedulable work.
 *
 * Meals come from the user's training plan, which specifies a real breakfast
 * (~600 cal, not a snack on the way out) and protein at dinner. Modelling
 * these as free time is how a scheduler ends up proposing a day nobody can
 * actually live.
 */
export function dailyOverheadFor(weekday: number, bedtime: MinuteOfDay): TimeRange[] {
  const isWeekend = weekday > 5;
  const out: TimeRange[] = [
    // breakfast — the training plan's single biggest requested change
    { start: hm("06:00"), end: hm("06:30") },
    // wind-down, hygiene, and the pre-bed protein
    { start: bedtime - 30, end: bedtime },
  ];

  if (isWeekend) {
    out.push({ start: hm("12:30"), end: hm("13:15") }); // lunch
  }
  out.push({ start: hm("19:00"), end: hm("19:40") }); // dinner

  return out;
}

/** Shortest stretch worth offering to the solver at all. */
export const MIN_USEFUL_SLOT = 20;

export interface SlotOptions {
  sleep?: SleepModel;
  prayer?: PrayerConfig;
  energyOverrides?: EnergyOverride[];
  /** extra one-off commitments beyond the recurring school schedule */
  extraCommitments?: (FixedCommitment & { date?: IsoDate })[];
}

export function datesBetween(start: IsoDate, days: number): IsoDate[] {
  const out: IsoDate[] = [];
  let d = DateTime.fromISO(start);
  for (let i = 0; i < days; i++) {
    const iso = d.toISODate();
    if (!iso) throw new Error(`Bad date at offset ${i} from ${start}`);
    out.push(iso);
    d = d.plus({ days: 1 });
  }
  return out;
}

/** Luxon weekday is already 1 = Mon .. 7 = Sun. */
export function weekdayOf(date: IsoDate): number {
  const w = DateTime.fromISO(date).weekday;
  if (!w) throw new Error(`Bad date: ${date}`);
  return w;
}

export function slotsForDate(date: IsoDate, opts: SlotOptions = {}): Slot[] {
  const sleep = opts.sleep ?? DEFAULT_SLEEP;
  const prayerConfig = opts.prayer ?? LA_MESA;
  const weekday = weekdayOf(date);
  const envelope = dayEnvelope(date, sleep);

  const commitments = [
    ...fixedCommitmentsFor(weekday),
    ...(opts.extraCommitments ?? [])
      .filter((c) => (c.date ? c.date === date : c.weekday === weekday)),
  ];

  // every commitment is busy for the purposes of general free time. Workable
  // ones (the free period) are added back below as off-site slots — if they
  // were merely skipped here they would also show up inside the surrounding
  // free stretch and be counted twice.
  const busy: TimeRange[] = commitments.map((c) => ({ start: c.start, end: c.end }));

  for (const o of dailyOverheadFor(weekday, envelope.end)) {
    busy.push({ start: o.start, end: o.end });
  }

  // prayer blocks are immovable; only the reserved head of each window is
  // taken, not the whole window
  for (const b of prayerBlocks(date, prayerConfig)) {
    busy.push({ start: b.start, end: b.end });
  }

  // arrive home, decompress, eat the post-school meal
  const home = homeTimeFor(weekday);
  if (home !== null) busy.push({ start: home, end: home + SETTLE_MIN });

  const free = subtractRanges(envelope, busy);

  const slots: Slot[] = free
    .filter((r) => r.end - r.start >= MIN_USEFUL_SLOT)
    .map((r) => ({
      date,
      weekday,
      start: r.start,
      end: r.end,
      energy: energyAt(weekday, r.start, envelope.end, opts.energyOverrides),
    }));

  // The free period: usable, but he is at school. Trim against everything
  // except the commitment itself — it is in `busy` so the surrounding free
  // stretch does not swallow it, but it must not cancel itself out here.
  for (const c of commitments) {
    if (!c.workable) continue;
    const others = busy.filter((b) => !(b.start === c.start && b.end === c.end));
    const trimmed = subtractRanges({ start: c.start, end: c.end }, others);
    for (const r of trimmed) {
      if (r.end - r.start < MIN_USEFUL_SLOT) continue;
      slots.push({
        date,
        weekday,
        start: r.start,
        end: r.end,
        energy: energyAt(weekday, r.start, envelope.end, opts.energyOverrides),
        offSite: true,
      });
    }
  }

  return slots.sort((a, b) => a.start - b.start);
}

export function slotsForHorizon(start: IsoDate, days: number, opts: SlotOptions = {}): Slot[] {
  return datesBetween(start, days).flatMap((d) => slotsForDate(d, opts));
}

export function totalMinutes(slots: Slot[]): number {
  return slots.reduce((sum, s) => sum + (s.end - s.start), 0);
}
