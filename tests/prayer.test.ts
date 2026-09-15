import { describe, it, expect } from "vitest";
import {
  rawPrayerTimes,
  prayerBlocks,
  maghribOffsetFromSunset,
  islamicMidnightMinute,
  JAFARI_ANGLES,
} from "../src/core/prayer";
import { hm } from "../src/core/types";

describe("Jafari prayer times (La Mesa, CA)", () => {
  it("uses Jafari angles", () => {
    expect(JAFARI_ANGLES.fajrAngle).toBe(16);
    expect(JAFARI_ANGLES.ishaAngle).toBe(14);
    expect(JAFARI_ANGLES.maghribAngle).toBe(4);
  });

  // The single most important assertion in this file. adhan defaults Maghrib
  // to sunset (the Sunni convention). If `maghribAngle` is silently ignored,
  // this returns 0 and every Maghrib in the app is ~15 minutes too early.
  it("puts Maghrib after sunset, not at it", () => {
    for (const date of ["2026-09-15", "2026-12-15", "2027-03-15", "2027-06-15"]) {
      const offset = maghribOffsetFromSunset(date);
      expect(offset, `${date} offset`).toBeGreaterThanOrEqual(12);
      expect(offset, `${date} offset`).toBeLessThanOrEqual(20);
    }
  });

  it("orders the five times correctly through the year", () => {
    for (const date of ["2026-09-15", "2026-11-15", "2026-12-21", "2027-06-21"]) {
      const t = rawPrayerTimes(date);
      expect(t.fajr, date).toBeLessThan(t.sunrise);
      expect(t.sunrise, date).toBeLessThan(t.dhuhr);
      expect(t.dhuhr, date).toBeLessThan(t.asr);
      expect(t.asr, date).toBeLessThan(t.sunset);
      expect(t.sunset, date).toBeLessThan(t.maghrib);
      expect(t.maghrib, date).toBeLessThan(t.isha);
    }
  });

  it("produces three observed blocks, not five", () => {
    const blocks = prayerBlocks("2026-09-15");
    expect(blocks.map((b) => b.name)).toEqual(["fajr", "dhuhr-asr", "maghrib-isha"]);
  });

  it("reserves only the head of each window, leaving the rest schedulable", () => {
    const [, dhuhrAsr] = prayerBlocks("2026-09-15");
    expect(dhuhrAsr).toBeDefined();
    if (!dhuhrAsr) return;
    // reserved block is short; the permissible window runs until Maghrib
    expect(dhuhrAsr.end - dhuhrAsr.start).toBe(25);
    expect(dhuhrAsr.window.end - dhuhrAsr.window.start).toBeGreaterThan(300);
  });

  // DST ends 2026-11-01. Dhuhr jumps roughly an hour earlier in clock time,
  // which moves it out of the lunch break and into 4th period.
  it("moves Dhuhr an hour earlier across the DST boundary", () => {
    const before = rawPrayerTimes("2026-10-25").dhuhr;
    const after = rawPrayerTimes("2026-11-08").dhuhr;
    expect(before - after).toBeGreaterThan(50);
    expect(before - after).toBeLessThan(70);
  });

  it("puts the September Dhuhr window after lunch ends", () => {
    // lunch is 12:18-12:54; Dhuhr enters ~12:43, leaving ~11 usable minutes
    const dhuhr = rawPrayerTimes("2026-09-15").dhuhr;
    expect(dhuhr).toBeGreaterThan(hm("12:18"));
    expect(hm("12:54") - dhuhr).toBeLessThan(20);
  });

  it("puts the November Dhuhr window comfortably before lunch", () => {
    const dhuhr = rawPrayerTimes("2026-11-15").dhuhr;
    expect(dhuhr).toBeLessThan(hm("12:18"));
  });

  it("computes Jafari midnight between sunset and Fajr, past the date boundary", () => {
    const midnight = islamicMidnightMinute("2026-09-15");
    expect(midnight).toBeGreaterThan(1440);
    expect(midnight).toBeLessThan(1440 + 120);
  });
});
