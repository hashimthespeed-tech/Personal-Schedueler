import { describe, it, expect } from "vitest";
import { DEFAULT_SLEEP, netSleepFrom } from "../src/core/sleep";
import { rawPrayerTimes } from "../src/core/prayer";
import { hm, toHm } from "../src/core/types";
import { DateTime } from "luxon";

function addDays(iso: string, days: number): string {
  const next = DateTime.fromISO(iso).plus({ days }).toISODate();
  if (!next) throw new Error(`Cannot step ${days} days from ${iso}`);
  return next;
}

describe("net sleep", () => {
  it("wraps across midnight", () => {
    expect(netSleepFrom(hm("23:10"), hm("06:00"))).toBe(410);
    expect(netSleepFrom(hm("22:00"), hm("06:00"))).toBe(480);
  });

  it("handles a bedtime after midnight", () => {
    // 00:30 -> 06:00 is five and a half hours, not a negative number
    expect(netSleepFrom(hm("00:30"), hm("06:00"))).toBe(330);
  });

  it("gives a full day when the two times are equal", () => {
    expect(netSleepFrom(hm("22:00"), hm("22:00"))).toBe(1440);
  });

  it("hits the target from the routine's own lights out", () => {
    // 22:00 lights out, 06:00 wake — the routine is built to land exactly here
    expect(netSleepFrom(hm("22:00"), DEFAULT_SLEEP.dayStart)).toBe(DEFAULT_SLEEP.targetSleepMin);
  });
});

/**
 * Why there is only one wake.
 *
 * The old model deducted twenty minutes a night for a Fajr wake, because Fajr
 * enters before 06:00 every day of the year here. But the window does not close
 * until sunrise, and through the school year sunrise is late enough that he can
 * simply pray when he gets up. These tests are the evidence for that — if the
 * calculation method or the location ever changes, they fail rather than
 * quietly invalidating the whole morning.
 */
describe("one wake at 06:00", () => {
  const WAKE = DEFAULT_SLEEP.dayStart;

  it("has Fajr already entered at 06:00, every day of the year", () => {
    let latest = -1;
    for (let i = 0; i < 365; i++) {
      latest = Math.max(latest, rawPrayerTimes(addDays("2026-08-01", i)).fajr);
    }
    expect(latest).toBeLessThan(WAKE);
    // the closest it ever gets, the day before the November clock change
    expect(toHm(latest)).toBe("05:51");
  });

  it("still has the window open at 06:00 from August through the start of May", () => {
    for (let date = "2026-08-01"; date <= "2027-05-01"; date = addDays(date, 1)) {
      const { fajr, sunrise } = rawPrayerTimes(date);
      expect(fajr, date).toBeLessThan(WAKE);
      expect(sunrise, date).toBeGreaterThan(WAKE);
    }
  });

  /**
   * The honest edge. From 2 May sunrise beats the alarm, so the last six weeks
   * of school need an earlier wake or an earlier prayer — the routine's `wake`
   * is a config field for exactly this.
   */
  it("loses the window on 2 May, not at the end of school", () => {
    expect(rawPrayerTimes("2027-05-01").sunrise).toBeGreaterThan(WAKE);
    expect(rawPrayerTimes("2027-05-02").sunrise).toBeLessThanOrEqual(WAKE);
    expect(toHm(rawPrayerTimes("2027-05-02").sunrise)).toBe("06:00");
  });

  it("is comfortably open in the months that matter most", () => {
    for (const [date, sunrise] of [
      ["2026-08-12", "06:10"], // first day of term
      ["2026-09-15", "06:32"],
      ["2026-12-17", "06:44"], // last day of the semester
      ["2027-01-15", "06:51"], // latest sunrise of the year
      ["2027-04-15", "06:19"],
    ] as const) {
      expect(toHm(rawPrayerTimes(date).sunrise), date).toBe(sunrise);
    }
  });
});
