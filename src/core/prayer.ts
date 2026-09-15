/**
 * Prayer times — Shia (Jafari) configuration.
 *
 * Computed locally by `adhan` from coordinates using Jean Meeus astronomical
 * algorithms. No API, no network.
 *
 * Two things here differ from a default (Sunni) setup and both matter:
 *
 *  1. `maghribAngle = 4`. adhan defaults Maghrib to sunset. The dominant Shia
 *     position holds that Maghrib begins once the eastern redness has passed
 *     overhead, modeled as 4 degrees of solar depression — roughly 13-17
 *     minutes after sunset at San Diego's latitude. Getting this wrong makes
 *     every Maghrib in the app too early.
 *
 *  2. The user combines. Five times are computed, then grouped into three
 *     observed blocks: Fajr, Dhuhr+Asr, Maghrib+Isha.
 */

import * as adhan from "adhan";
import { DateTime } from "luxon";
import type { IsoDate, MinuteOfDay, TimeRange } from "./types.js";

export interface PrayerConfig {
  latitude: number;
  longitude: number;
  timezone: string;
  /** minutes budgeted for wudhu + salah, per observed block */
  fajrDurationMin: number;
  dhuhrAsrDurationMin: number;
  maghribIshaDurationMin: number;
}

/** La Mesa, San Diego County, California. */
export const LA_MESA: PrayerConfig = {
  latitude: 32.7678,
  longitude: -117.0231,
  timezone: "America/Los_Angeles",
  fajrDurationMin: 20,
  dhuhrAsrDurationMin: 25,
  maghribIshaDurationMin: 25,
};

/** Jafari — Leva Research Institute, Qum. */
export const JAFARI_ANGLES = {
  fajrAngle: 16,
  ishaAngle: 14,
  maghribAngle: 4,
} as const;

function jafariParams(): adhan.CalculationParameters {
  const params = adhan.CalculationMethod.Other();
  params.fajrAngle = JAFARI_ANGLES.fajrAngle;
  params.ishaAngle = JAFARI_ANGLES.ishaAngle;
  params.maghribAngle = JAFARI_ANGLES.maghribAngle;
  params.madhab = adhan.Madhab.Shafi;
  return params;
}

/** All five computed times, as minutes since local midnight. */
export interface RawPrayerTimes {
  fajr: MinuteOfDay;
  sunrise: MinuteOfDay;
  dhuhr: MinuteOfDay;
  asr: MinuteOfDay;
  maghrib: MinuteOfDay;
  isha: MinuteOfDay;
  sunset: MinuteOfDay;
}

export type PrayerBlockName = "fajr" | "dhuhr-asr" | "maghrib-isha";

export interface PrayerBlock {
  name: PrayerBlockName;
  label: string;
  /** when the block's time enters */
  start: MinuteOfDay;
  /** start + budgeted duration — what the solver carves out */
  end: MinuteOfDay;
  /**
   * The full permissible window. The solver reserves only `start..end`, but
   * the UI shows this so the user can see how much room they actually have.
   */
  window: TimeRange;
}

function minuteOfDay(date: Date, timezone: string): MinuteOfDay {
  const dt = DateTime.fromJSDate(date, { zone: timezone });
  return dt.hour * 60 + dt.minute;
}

export function rawPrayerTimes(date: IsoDate, config: PrayerConfig = LA_MESA): RawPrayerTimes {
  const local = DateTime.fromISO(date, { zone: config.timezone });
  if (!local.isValid) throw new Error(`Bad date: ${date}`);

  const coords = new adhan.Coordinates(config.latitude, config.longitude);
  const times = new adhan.PrayerTimes(coords, local.toJSDate(), jafariParams());

  const at = (d: Date) => minuteOfDay(d, config.timezone);

  return {
    fajr: at(times.fajr),
    sunrise: at(times.sunrise),
    dhuhr: at(times.dhuhr),
    asr: at(times.asr),
    maghrib: at(times.maghrib),
    isha: at(times.isha),
    sunset: at(times.sunset),
  };
}

/**
 * The three blocks the user actually observes.
 *
 * Window ends: the Dhuhr+Asr window runs until Maghrib; the Maghrib+Isha
 * window runs until Islamic midnight. Praying early in each window is
 * preferred — the solver reserves the front of it and treats the rest as
 * available time.
 */
export function prayerBlocks(date: IsoDate, config: PrayerConfig = LA_MESA): PrayerBlock[] {
  const t = rawPrayerTimes(date, config);
  const islamicMidnight = islamicMidnightMinute(date, config);

  return [
    {
      name: "fajr",
      label: "Fajr",
      start: t.fajr,
      end: t.fajr + config.fajrDurationMin,
      window: { start: t.fajr, end: t.sunrise },
    },
    {
      name: "dhuhr-asr",
      label: "Dhuhr + Asr",
      start: t.dhuhr,
      end: t.dhuhr + config.dhuhrAsrDurationMin,
      window: { start: t.dhuhr, end: t.maghrib },
    },
    {
      name: "maghrib-isha",
      label: "Maghrib + Isha",
      start: t.maghrib,
      end: t.maghrib + config.maghribIshaDurationMin,
      window: { start: t.maghrib, end: islamicMidnight },
    },
  ];
}

/**
 * Jafari midnight: the mid-point between sunset and Fajr (not sunset to
 * sunrise). Returned as minutes since midnight on `date`, which can exceed
 * 1440 when it falls after the date boundary — callers clamp as needed.
 */
export function islamicMidnightMinute(date: IsoDate, config: PrayerConfig = LA_MESA): MinuteOfDay {
  const today = rawPrayerTimes(date, config);
  const nextDate = DateTime.fromISO(date, { zone: config.timezone })
    .plus({ days: 1 })
    .toISODate();
  if (!nextDate) throw new Error(`Cannot advance date: ${date}`);
  const tomorrow = rawPrayerTimes(nextDate, config);

  const sunsetToFajr = 1440 - today.maghrib + tomorrow.fajr;
  return today.maghrib + Math.floor(sunsetToFajr / 2);
}

/**
 * Minutes between sunset and Maghrib. Exists so a test can assert the Jafari
 * offset is actually being applied — if this returns 0, `maghribAngle` was
 * silently ignored and every Maghrib in the app is wrong.
 */
export function maghribOffsetFromSunset(date: IsoDate, config: PrayerConfig = LA_MESA): number {
  const t = rawPrayerTimes(date, config);
  return t.maghrib - t.sunset;
}
