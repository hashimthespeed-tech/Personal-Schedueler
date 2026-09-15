/** Core domain types. Pure data — no DB, no framework, no I/O. */

export type Domain = "school" | "deen" | "ai" | "money" | "physique";
export type Energy = "high" | "med" | "low";
export type AgentName = "coach" | "tutor" | "ustadh" | "builder" | "system";

/** Minutes since local midnight. Keeps slot math integer-only and DST-safe. */
export type MinuteOfDay = number;

/** ISO date, `YYYY-MM-DD`, always in the user's local zone. */
export type IsoDate = string;

export interface TimeRange {
  /** inclusive */
  start: MinuteOfDay;
  /** exclusive */
  end: MinuteOfDay;
}

/**
 * The integration contract. Every specialist emits this exact shape; the
 * solver is the only thing that turns one into a placed block.
 */
export interface Task {
  id: string;
  domain: Domain;
  title: string;
  notes?: string;
  durationMin: number;
  /** null/undefined = indivisible, must be placed in one contiguous slot */
  minChunkMin?: number | null;
  /** hard due date; the task is worthless after it */
  deadline?: IsoDate;
  /** time-of-day window, e.g. lifting only after school */
  earliestTime?: MinuteOfDay;
  latestTime?: MinuteOfDay;
  energy: Energy;
  /** 1 = highest */
  priority: 1 | 2 | 3 | 4 | 5;
  /** minimum hours between this task and its previous occurrence */
  spacing?: { minHoursBetween: number; groupKey: string };
  /** restrict to specific weekdays (1 = Mon .. 7 = Sun) */
  allowedWeekdays?: number[];
  sourceAgent: AgentName;
  /** movement tags, checked against athlete restrictions before placement */
  movementTags?: string[];
}

export interface FixedCommitment {
  id: string;
  title: string;
  /** 1 = Mon .. 7 = Sun */
  weekday: number;
  start: MinuteOfDay;
  end: MinuteOfDay;
  kind: "school" | "practice" | "prayer" | "meal" | "commute" | "other";
  /** true when the user is away from home and cannot do arbitrary work */
  offSite?: boolean;
  /** true when this window is usable for schoolwork despite being fixed */
  workable?: boolean;
}

export interface Block {
  taskId: string;
  title: string;
  domain: Domain;
  date: IsoDate;
  start: MinuteOfDay;
  end: MinuteOfDay;
  sourceAgent: AgentName;
  /** set when a divisible task was split across slots */
  chunkIndex?: number;
  chunkCount?: number;
}

export type UnplacedReason =
  | "no_slot_long_enough"
  | "no_slot_before_deadline"
  | "no_slot_in_time_window"
  | "no_slot_on_allowed_weekday"
  | "spacing_conflict"
  | "movement_restricted"
  | "horizon_full";

export interface Unplaced {
  taskId: string;
  title: string;
  domain: Domain;
  reason: UnplacedReason;
  /** human-readable, shown directly in the UI */
  detail: string;
}

export interface SolverResult {
  blocks: Block[];
  unplaced: Unplaced[];
  /** fraction of available free time consumed, 0..1 */
  utilization: number;
  /** total free minutes in the horizon after fixed commitments and sleep */
  freeMinutes: number;
  /** total minutes actually scheduled */
  scheduledMinutes: number;
}

/** A contiguous stretch of usable time on one date. */
export interface Slot {
  date: IsoDate;
  /** 1 = Mon .. 7 = Sun */
  weekday: number;
  start: MinuteOfDay;
  end: MinuteOfDay;
  energy: Energy;
  /** true if this slot is at school (period 7) — only schoolwork fits */
  offSite?: boolean;
}

export const MIN = 1;
export const HOUR = 60;

/**
 * Normalize a minute-of-day that ran past midnight. Islamic midnight and
 * late-evening windows routinely exceed 1440; without this they format as
 * afternoon times.
 */
export function wrapMinute(minute: MinuteOfDay): MinuteOfDay {
  return ((minute % 1440) + 1440) % 1440;
}

/** `"14:30"` -> 870 */
export function hm(text: string): MinuteOfDay {
  const [h, m] = text.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) {
    throw new Error(`Bad time literal: ${text}`);
  }
  return h * 60 + m;
}

/** 870 -> `"14:30"` */
export function toHm(minute: MinuteOfDay): string {
  const w = wrapMinute(minute);
  const h = Math.floor(w / 60);
  const m = w % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** 870 -> `"2:30 PM"` */
export function to12h(minute: MinuteOfDay): string {
  const w = wrapMinute(minute);
  const h24 = Math.floor(w / 60);
  const m = w % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function durationOf(range: TimeRange): number {
  return range.end - range.start;
}

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Subtract a set of busy ranges from one free range. Returns the gaps left. */
export function subtractRanges(free: TimeRange, busy: TimeRange[]): TimeRange[] {
  const sorted = busy
    .filter((b) => overlaps(free, b))
    .sort((a, b) => a.start - b.start);

  const out: TimeRange[] = [];
  let cursor = free.start;

  for (const b of sorted) {
    if (b.start > cursor) out.push({ start: cursor, end: Math.min(b.start, free.end) });
    cursor = Math.max(cursor, b.end);
    if (cursor >= free.end) break;
  }
  if (cursor < free.end) out.push({ start: cursor, end: free.end });

  return out.filter((r) => r.end > r.start);
}
