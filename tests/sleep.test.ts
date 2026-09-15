import { describe, it, expect } from "vitest";
import {
  bedtimeFor,
  sleepNightFor,
  fajrInterruptionFor,
  dayEnvelope,
  weeksIntoRamp,
  DEFAULT_SLEEP,
} from "../src/core/sleep.js";
import { hm, toHm } from "../src/core/types.js";

describe("sleep model", () => {
  it("starts at the user's current bedtime, not the goal", () => {
    expect(toHm(bedtimeFor("2026-09-15"))).toBe("23:00");
  });

  it("walks bedtime 15 minutes earlier per week and stops at the goal", () => {
    const seen: string[] = [];
    for (let week = 0; week <= 8; week++) {
      const date = `2026-${String(9 + Math.floor((15 + week * 7) / 30)).padStart(2, "0")}-01`;
      void date;
      seen.push(toHm(bedtimeFor(addDays("2026-09-15", week * 7))));
    }
    expect(seen).toEqual([
      "23:00", "22:45", "22:30", "22:15", "22:00", "21:45", "21:40", "21:40", "21:40",
    ]);
  });

  it("never overshoots past the goal bedtime", () => {
    expect(toHm(bedtimeFor(addDays("2026-09-15", 365)))).toBe("21:40");
  });

  it("does not move the bedtime before the ramp starts", () => {
    expect(weeksIntoRamp("2026-09-01")).toBe(0);
    expect(toHm(bedtimeFor("2026-09-01"))).toBe("23:00");
  });

  // September: Fajr ~05:19, before the 06:00 anchor, so sleep is interrupted.
  it("charges the Fajr interruption when Fajr is before dayStart", () => {
    expect(fajrInterruptionFor("2026-09-15")).toBe(20);
    const night = sleepNightFor("2026-09-15");
    expect(night.fajrAfterDayStart).toBe(false);
    expect(night.interruptionMin).toBe(20);
  });

  // At this latitude Fajr never reaches the 06:00 anchor. It runs from 04:11
  // (mid-June) to 05:55 (the March DST jump), so the interruption is charged
  // every single day of the year — there is no winter month where Fajr simply
  // becomes the morning.
  it("never lets Fajr reach dayStart anywhere in the year at this latitude", () => {
    let latest = -1;
    for (let i = 0; i < 365; i++) {
      const date = addDays("2026-01-01", i);
      latest = Math.max(latest, sleepNightFor(date).fajr);
    }
    expect(latest).toBeLessThan(DEFAULT_SLEEP.dayStart);
    expect(latest).toBeGreaterThan(hm("05:45"));
  });

  it("charges the interruption on every day of the year", () => {
    for (const date of ["2026-03-08", "2026-06-10", "2026-09-15", "2026-12-28"]) {
      expect(fajrInterruptionFor(date), date).toBe(20);
      expect(sleepNightFor(date).fajrAfterDayStart, date).toBe(false);
    }
  });

  // The zero-interruption branch still has to work — it is what a move north,
  // or a later Fajr convention, would hit.
  it("charges nothing when Fajr does land after dayStart", () => {
    const earlyRiser = { ...DEFAULT_SLEEP, dayStart: hm("05:00") };
    const night = sleepNightFor("2026-09-15", earlyRiser);
    expect(night.fajr).toBeGreaterThanOrEqual(earlyRiser.dayStart);
    expect(night.fajrAfterDayStart).toBe(true);
    expect(night.interruptionMin).toBe(0);
  });

  it("reports the user's real current sleep as well under target", () => {
    // 23:00 -> 06:00 is 7h gross, 6h40m net after Fajr
    const night = sleepNightFor("2026-09-15");
    expect(night.netSleepMin).toBe(400);
    expect(night.vsTargetMin).toBe(-80);
  });

  it("reaches the 8h target once the ramp completes", () => {
    const night = sleepNightFor(addDays("2026-09-15", 7 * 7));
    expect(toHm(night.bedtime)).toBe("21:40");
    expect(night.netSleepMin).toBe(DEFAULT_SLEEP.targetSleepMin);
    expect(night.vsTargetMin).toBe(0);
  });

  it("closes the day envelope at the ramped bedtime", () => {
    const early = dayEnvelope("2026-09-15");
    expect(early.start).toBe(hm("06:00"));
    expect(early.end).toBe(hm("23:00"));

    const later = dayEnvelope(addDays("2026-09-15", 7 * 7));
    expect(later.end).toBe(hm("21:40"));
  });
});

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
