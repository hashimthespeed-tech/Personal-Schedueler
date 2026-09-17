/** Core domain types. Pure data — no DB, no framework, no I/O. */

export type Domain = "school" | "deen" | "ai" | "money" | "physique";

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
