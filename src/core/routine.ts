/**
 * The fixed daily routine.
 *
 * This replaces the solver. Not because the solver was broken — it packed
 * constraints correctly — but because it was solving the wrong problem. A
 * schedule that is re-derived every night can never become a habit, and a habit
 * is the entire point. Four hours a day, in the same order, is something a
 * person can learn. A different arrangement every morning is something they
 * have to read.
 *
 * So the week is decided once, here, and lived. There is exactly one computed
 * value in it: Maghrib, which swings from 4:58 PM in December to 8:17 PM in
 * June and therefore cannot be a constant.
 *
 * Nothing in this file touches the database or an agent. Given a date it
 * returns the same day every time, which is what makes it testable and what
 * makes it a routine.
 */

import { DateTime } from "luxon";
import { prayerBlocks, LA_MESA, type PrayerConfig } from "./prayer";
import type { Domain, IsoDate, MinuteOfDay } from "./types";

export type DayType = "school" | "practice" | "weekend";

/**
 * What a slot is for, which decides how it is drawn and whether it is scored.
 *
 * - `core`   the four hours that are the point of the whole thing
 * - `prayer` the three blocks, one of which moves
 * - `fixed`  structure — eating, showering, school. Not yours to move, and
 *            crucially it exists at all, which the old day model got wrong:
 *            it had nothing between the commute home and bedtime, so it
 *            believed every evening was five free hours
 * - `anchor` waking and lights out; a time, not a task
 * - `free`   deliberately empty and deliberately shown
 */
export type SlotKind = "core" | "prayer" | "fixed" | "anchor" | "free";

export interface Slot {
  /** stable across days — what completion is logged against */
  key: string;
  label: string;
  detail?: string;
  kind: SlotKind;
  domain?: Domain;
  start: MinuteOfDay;
  end: MinuteOfDay;
  /** counts toward the consistency score */
  tracked: boolean;
}

export const MEAL_SLOT_KEYS = new Set(["breakfast", "post-school-meal", "dinner", "wind-down"]);

/** Slots whose completion can carry an optional calorie value. */
export function isMealSlot(slot: Pick<Slot, "key"> | string): boolean {
  return MEAL_SLOT_KEYS.has(typeof slot === "string" ? slot : slot.key);
}

export interface Day {
  date: IsoDate;
  type: DayType;
  /** 1 = Monday */
  weekday: number;
  wake: MinuteOfDay;
  lightsOut: MinuteOfDay;
  slots: Slot[];
}

/* ------------------------------------------------------------------ */
/* The template                                                        */
/* ------------------------------------------------------------------ */

export interface RoutineConfig {
  /** weekday wake, minutes since midnight */
  wake: MinuteOfDay;
  weekendWake: MinuteOfDay;
  lightsOut: MinuteOfDay;
  weekendLightsOut: MinuteOfDay;
  /** minutes for each of the four core blocks */
  coreMin: number;
  /** Mon=1 .. Sun=7 */
  practiceDays: number[];
  liftDays: number[];
  /** when he leaves the house, and when he is back */
  leaveHome: MinuteOfDay;
  fridayLeaveHome: MinuteOfDay;
  homeFromSchool: MinuteOfDay;
  homeFromPractice: MinuteOfDay;
  /** the free period, which is school work that costs nothing at home */
  freePeriodStart: MinuteOfDay;
  freePeriodMin: number;
}

export const DEFAULT_ROUTINE: RoutineConfig = {
  wake: 6 * 60,
  weekendWake: 6 * 60 + 30,
  lightsOut: 22 * 60,
  weekendLightsOut: 22 * 60 + 30,
  coreMin: 60,
  practiceDays: [2, 4],
  liftDays: [1, 3, 5, 6],
  leaveHome: 8 * 60 + 5,
  fridayLeaveHome: 8 * 60 + 35,
  homeFromSchool: 15 * 60 + 55,
  homeFromPractice: 17 * 60 + 30,
  freePeriodStart: 14 * 60 + 46,
  freePeriodMin: 50,
};

export function dayTypeFor(weekday: number, config: RoutineConfig = DEFAULT_ROUTINE): DayType {
  if (weekday >= 6) return "weekend";
  return config.practiceDays.includes(weekday) ? "practice" : "school";
}

/** A small builder so the template below reads as a timetable, not as arithmetic. */
class Timeline {
  private cursor: MinuteOfDay;
  readonly slots: Slot[] = [];

  constructor(start: MinuteOfDay) {
    this.cursor = start;
  }

  at(): MinuteOfDay {
    return this.cursor;
  }

  jump(to: MinuteOfDay): void {
    this.cursor = to;
  }

  add(minutes: number, slot: Omit<Slot, "start" | "end">): Slot {
    const made: Slot = { ...slot, start: this.cursor, end: this.cursor + minutes };
    this.slots.push(made);
    this.cursor += minutes;
    return made;
  }

  /** A zero-length marker: waking, lights out. */
  mark(slot: Omit<Slot, "start" | "end">): void {
    this.slots.push({ ...slot, start: this.cursor, end: this.cursor });
  }
}

const MORNING = {
  fajr: 15,
  breakfast: 30,
  outTheDoor: 20,
} as const;

/**
 * The morning, which is identical on all five school days.
 *
 * 6:00 to 8:05 is 125 minutes and all 125 are spent: 15 on wudhu and Fajr, 60
 * on the Islam block, 30 on a real breakfast, 20 to dress and leave. There is
 * no spare hour in it, which is worth stating in code because it keeps looking
 * like there is one.
 */
function schoolMorning(t: Timeline, leave: MinuteOfDay): void {
  t.add(MORNING.fajr, {
    key: "fajr",
    label: "Fajr",
    detail: "Wudhu with cool water. This is the wake-up, not a formality.",
    kind: "prayer",
    domain: "deen",
    tracked: true,
  });

  t.add(60, {
    key: "islam",
    label: "Islam",
    detail: "Quran, then study. Quiet house, clear head.",
    kind: "core",
    domain: "deen",
    tracked: true,
  });

  t.add(MORNING.breakfast, {
    key: "breakfast",
    label: "Breakfast",
    detail: "The real one. ~600 cal. This is the physique goal, not the lifting.",
    kind: "fixed",
    tracked: false,
  });

  t.add(MORNING.outTheDoor, {
    key: "leave",
    label: "Dress, pack, out",
    detail: "Bag packed last night buys you ten minutes here.",
    kind: "fixed",
    tracked: false,
  });

  // Friday starts thirty minutes later; that is slack, not a longer scramble
  if (leave > t.at()) {
    t.add(leave - t.at(), {
      key: "slow-start",
      label: "Slower start",
      detail: "Friday only. Nothing is scheduled in it.",
      kind: "free",
      tracked: false,
    });
  }
}

function eveningClose(t: Timeline, lightsOut: MinuteOfDay): void {
  const windDownStart = lightsOut - 45;

  if (t.at() < windDownStart) {
    t.add(windDownStart - t.at(), {
      key: "free",
      label: "Yours",
      detail: "Nothing is scheduled. Not tracked, not negotiable.",
      kind: "free",
      tracked: false,
    });
  }

  t.jump(windDownStart);
  t.add(30, {
    key: "wind-down",
    label: "Last feed, screens down",
    detail: "Greek yogurt or milk. Phone out of the room.",
    kind: "fixed",
    tracked: false,
  });

  // the last quarter hour was an unnamed hole; it is getting into bed, and
  // saying so is the difference between a buffer and a gap
  t.add(lightsOut - t.at(), {
    key: "to-bed",
    label: "In bed",
    kind: "fixed",
    tracked: false,
  });

  t.jump(lightsOut);
  t.mark({ key: "lights-out", label: "Lights out", kind: "anchor", tracked: false });
}

/* ------------------------------------------------------------------ */
/* Day generation                                                      */
/* ------------------------------------------------------------------ */

export interface DayOptions {
  routine?: RoutineConfig;
  prayer?: PrayerConfig;
  /** an extra hour of school work, when he flips the switch for that day */
  extraSchoolHour?: boolean;
}

export function dayFor(date: IsoDate, options: DayOptions = {}): Day {
  const routine = options.routine ?? DEFAULT_ROUTINE;
  const prayerConfig = options.prayer ?? LA_MESA;
  const weekday = DateTime.fromISO(date).weekday;
  const type = dayTypeFor(weekday, routine);

  const wake = type === "weekend" ? routine.weekendWake : routine.wake;
  const lightsOut = type === "weekend" ? routine.weekendLightsOut : routine.lightsOut;

  const t = new Timeline(wake);
  t.mark({ key: "wake", label: "Up", kind: "anchor", tracked: false });

  if (type === "weekend") {
    buildWeekend(t, routine, weekday, options.extraSchoolHour === true);
  } else {
    buildSchoolDay(t, routine, weekday, type, options.extraSchoolHour === true);
  }

  eveningClose(t, lightsOut);

  const slots = withMaghrib(t.slots, date, prayerConfig, type, routine);

  return { date, type, weekday, wake, lightsOut, slots };
}

function buildSchoolDay(
  t: Timeline,
  routine: RoutineConfig,
  weekday: number,
  type: DayType,
  extraSchoolHour: boolean,
): void {
  const leave = weekday === 5 ? routine.fridayLeaveHome : routine.leaveHome;
  schoolMorning(t, leave);

  t.jump(leave);
  t.add(routine.freePeriodStart - leave, {
    key: "school",
    label: "School",
    kind: "fixed",
    tracked: false,
  });

  // Dhuhr + Asr is open through the free period every day of the year, and he
  // is sitting there anyway — so it is a school-side slot, not a home one.
  t.add(routine.freePeriodMin, {
    key: "period-7",
    label: "Period 7 — free",
    detail: "Homework here costs you nothing at home. Dhuhr + Asr fits too.",
    kind: "core",
    domain: "school",
    tracked: true,
  });

  if (type === "practice") {
    // practice was missing from the day entirely, which left a two-hour hole
    // on the calendar where the hardest thing he does all week actually is
    t.add(routine.homeFromPractice - t.at(), {
      key: "practice",
      label: "Practice",
      detail: "This is the training hour. Nothing goes on top of it.",
      kind: "core",
      domain: "physique",
      tracked: true,
    });

    t.add(30, {
      key: "post-school-meal",
      label: "Home. Two plates.",
      detail: "Sit down for it. ~800 cal.",
      kind: "fixed",
      tracked: false,
    });
    t.add(20, { key: "shower", label: "Shower", kind: "fixed", tracked: false });
  } else {
    t.add(routine.homeFromSchool - t.at(), {
      key: "commute-home",
      label: "Walk home",
      kind: "fixed",
      tracked: false,
    });

    t.add(25, {
      key: "post-school-meal",
      label: "Home. Two plates.",
      detail: "Sit down for it. ~800 cal.",
      kind: "fixed",
      tracked: false,
    });
    t.add(routine.coreMin, {
      key: "train",
      label: routine.liftDays.includes(weekday) ? "Train" : "Move",
      detail: "Fed, not fried. Near your daily strength peak, already warm from PE.",
      kind: "core",
      domain: "physique",
      tracked: true,
    });
    t.add(25, { key: "shower", label: "Shower", kind: "fixed", tracked: false });
  }

  t.add(routine.coreMin, {
    key: "school-work",
    label: "School work",
    detail: "Fed, showered, tension gone. Your best evening hour.",
    kind: "core",
    domain: "school",
    tracked: true,
  });

  t.add(30, { key: "dinner", label: "Dinner", kind: "fixed", tracked: false });

  t.add(routine.coreMin, {
    key: "build",
    label: "Business & AI",
    detail: "Last on purpose — you want to do it, so it survives being tired.",
    kind: "core",
    domain: "ai",
    tracked: true,
  });

  if (extraSchoolHour) {
    t.add(routine.coreMin, {
      key: "school-work-extra",
      label: "School work — second hour",
      detail: "You asked for this one today.",
      kind: "core",
      domain: "school",
      tracked: true,
    });
  }
}

function buildWeekend(
  t: Timeline,
  routine: RoutineConfig,
  weekday: number,
  extraSchoolHour: boolean,
): void {
  t.add(MORNING.fajr, {
    key: "fajr",
    label: "Fajr",
    detail: "The easiest Fajr of the week.",
    kind: "prayer",
    domain: "deen",
    tracked: true,
  });

  t.add(60, {
    key: "islam",
    label: "Islam",
    detail: "Same hour, same place in the day.",
    kind: "core",
    domain: "deen",
    tracked: true,
  });

  t.add(45, { key: "breakfast", label: "Breakfast", kind: "fixed", tracked: false });

  t.add(routine.coreMin, {
    key: "build",
    label: "Business & AI",
    detail: "Your sharpest hour all week. Give it the hard thing.",
    kind: "core",
    domain: "ai",
    tracked: true,
  });

  const lifting = routine.liftDays.includes(weekday);
  t.add(routine.coreMin, {
    key: "train",
    label: lifting ? "Train" : "Walk, stretch the ankle",
    detail: lifting ? "Saturday session." : "Sunday is recovery. It counts.",
    kind: "core",
    domain: "physique",
    tracked: true,
  });

  t.add(30, { key: "shower", label: "Shower", kind: "fixed", tracked: false });

  t.add(routine.coreMin, {
    key: "school-work",
    label: "School work",
    detail: "Clear the week's overflow.",
    kind: "core",
    domain: "school",
    tracked: true,
  });

  if (extraSchoolHour) {
    t.add(routine.coreMin, {
      key: "school-work-extra",
      label: "School work — second hour",
      kind: "core",
      domain: "school",
      tracked: true,
    });
  }

  // Dhuhr + Asr has no school to hide behind at the weekend
  t.add(20, {
    key: "dhuhr-asr",
    label: "Dhuhr + Asr",
    kind: "prayer",
    domain: "deen",
    tracked: true,
  });
}

/**
 * Drop Maghrib + Isha into the day at its real time.
 *
 * The only thing here that is not a constant. It lands inside the working
 * evening every day of the year, so rather than pretend it has a fixed home it
 * is inserted where it actually falls and the block it interrupts is noted as
 * running twenty minutes long. The free hour before wind-down absorbs it.
 */
function withMaghrib(
  slots: Slot[],
  date: IsoDate,
  prayerConfig: PrayerConfig,
  type: DayType,
  routine: RoutineConfig,
): Slot[] {
  const maghrib = prayerBlocks(date, prayerConfig).find((b) => b.name === "maghrib-isha");
  if (!maghrib) return slots;

  const lightsOut = type === "weekend" ? routine.weekendLightsOut : routine.lightsOut;
  // if it falls after lights out — it does not in La Mesa, but latitude is a
  // setting — pin it to the last waking moment rather than dropping it
  const start = Math.min(maghrib.start, lightsOut - 20);

  const slot: Slot = {
    key: "maghrib-isha",
    label: "Maghrib + Isha",
    detail: "Moves all year — 4:58 PM in December, 8:17 PM in June.",
    kind: "prayer",
    domain: "deen",
    start,
    end: start + 20,
    tracked: true,
  };

  const out = [...slots, slot];
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

/* ------------------------------------------------------------------ */
/* Reading a day                                                       */
/* ------------------------------------------------------------------ */

/** Everything that gets a tick, in the order it happens. */
export function trackedSlots(day: Day): Slot[] {
  return day.slots.filter((s) => s.tracked);
}

/** The four (or five) hours, which is what the week is actually about. */
export function coreSlots(day: Day): Slot[] {
  return day.slots.filter((s) => s.kind === "core");
}

export function weekFrom(start: IsoDate, days = 7, options: DayOptions = {}): Day[] {
  const first = DateTime.fromISO(start);
  return Array.from({ length: days }, (_, i) => {
    const iso = first.plus({ days: i }).toISODate();
    if (!iso) throw new Error(`Cannot step ${i} days from ${start}`);
    return dayFor(iso, options);
  });
}

/**
 * Whether a slot overlaps the one after it.
 *
 * Maghrib is the one slot inserted rather than budgeted for — it moves three
 * hours across the year, so it genuinely does land on top of whatever is
 * running. Fajr and the weekend Dhuhr+Asr are laid in with everything else and
 * are held to the same standard, so this excludes exactly one key rather than
 * waving through every prayer.
 */
export const INSERTED_SLOT = "maghrib-isha";

export function overlapsIgnoringPrayer(day: Day): [Slot, Slot][] {
  const solid = day.slots.filter((s) => s.key !== INSERTED_SLOT && s.end > s.start);
  const clashes: [Slot, Slot][] = [];

  for (let i = 1; i < solid.length; i++) {
    const before = solid[i - 1]!;
    const after = solid[i]!;
    if (after.start < before.end) clashes.push([before, after]);
  }
  return clashes;
}
