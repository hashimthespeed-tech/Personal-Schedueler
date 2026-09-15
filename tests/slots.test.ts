import { describe, it, expect } from "vitest";
import { slotsForDate, slotsForHorizon, totalMinutes, weekdayOf } from "../src/core/slots";
import { fixedCommitmentsFor, lunchFor, homeTimeFor, BELL_REG, BELL_FRI } from "../src/data/school";
import { prayerBlocks } from "../src/core/prayer";
import { bedtimeFor } from "../src/core/sleep";
import { hm, overlaps, toHm } from "../src/core/types";

// 2026-09-14 is a Monday.
const MON = "2026-09-14";
const TUE = "2026-09-15";
const WED = "2026-09-16";
const THU = "2026-09-17";
const FRI = "2026-09-18";
const SAT = "2026-09-19";

describe("bell schedules", () => {
  it("maps the real weekdays", () => {
    expect(weekdayOf(MON)).toBe(1);
    expect(weekdayOf(FRI)).toBe(5);
    expect(weekdayOf(SAT)).toBe(6);
  });

  it("matches the published regular-day bells", () => {
    expect(BELL_REG.map((p) => `${toHm(p.start)}-${toHm(p.end)}`)).toEqual([
      "08:30-09:20", "09:26-10:16", "10:30-11:20", "11:26-12:18",
      "12:54-13:44", "13:50-14:40", "14:46-15:36",
    ]);
  });

  it("matches the published Friday late-start bells", () => {
    expect(BELL_FRI.map((p) => `${toHm(p.start)}-${toHm(p.end)}`)).toEqual([
      "09:00-09:42", "09:48-10:30", "11:04-11:46", "11:52-12:36",
      "13:12-13:54", "14:00-14:42", "14:48-15:30",
    ]);
  });

  it("derives lunch from the gap after period 4", () => {
    expect(lunchFor(1)).toEqual({ start: hm("12:18"), end: hm("12:54") });
    expect(lunchFor(5)).toEqual({ start: hm("12:36"), end: hm("13:12") });
  });

  // Friday has a 34-minute gap between periods 2 and 3 that regular days do
  // not. It must be covered as a commitment or it shows up as free time.
  it("covers the long Friday break so it is not mistaken for free time", () => {
    const gap = fixedCommitmentsFor(5).find((c) => c.start === hm("10:30"));
    expect(gap).toBeDefined();
    expect(gap?.title).toBe("Break");
    expect(gap?.workable).toBeFalsy();
  });

  it("leaves no uncovered gap between the first and last bell", () => {
    for (const weekday of [1, 2, 3, 4, 5]) {
      const bell = weekday === 5 ? BELL_FRI : BELL_REG;
      const commitments = fixedCommitmentsFor(weekday);
      const first = bell[0];
      const last = bell[bell.length - 1];
      if (!first || !last) throw new Error("no bells");

      for (let t = first.start; t < last.end; t += 1) {
        const covered = commitments.some((c) => t >= c.start && t < c.end);
        expect(covered, `weekday ${weekday} uncovered at ${toHm(t)}`).toBe(true);
      }
    }
  });

  it("gets home at 17:30 on practice days and mid-afternoon otherwise", () => {
    expect(toHm(homeTimeFor(2) ?? 0)).toBe("17:30");
    expect(toHm(homeTimeFor(4) ?? 0)).toBe("17:30");
    expect(toHm(homeTimeFor(1) ?? 0)).toBe("15:55");
    expect(toHm(homeTimeFor(5) ?? 0)).toBe("15:49");
  });
});

describe("free slots", () => {
  it("never overlaps a fixed commitment other than the free period", () => {
    for (const date of [MON, TUE, WED, THU, FRI]) {
      const weekday = weekdayOf(date);
      const commitments = fixedCommitmentsFor(weekday).filter((c) => !c.workable);
      for (const slot of slotsForDate(date)) {
        for (const c of commitments) {
          expect(
            overlaps({ start: slot.start, end: slot.end }, { start: c.start, end: c.end }),
            `${date} ${toHm(slot.start)}-${toHm(slot.end)} overlaps ${c.title}`,
          ).toBe(false);
        }
      }
    }
  });

  it("never overlaps a reserved prayer block", () => {
    for (const date of [MON, TUE, FRI, SAT]) {
      const blocks = prayerBlocks(date);
      for (const slot of slotsForDate(date)) {
        for (const b of blocks) {
          expect(
            overlaps({ start: slot.start, end: slot.end }, { start: b.start, end: b.end }),
            `${date} slot overlaps ${b.label}`,
          ).toBe(false);
        }
      }
    }
  });

  it("never runs past the ramped bedtime", () => {
    for (const date of [MON, "2026-10-20", "2026-11-17"]) {
      const bedtime = bedtimeFor(date);
      for (const slot of slotsForDate(date)) {
        expect(slot.end, `${date} slot past bedtime`).toBeLessThanOrEqual(bedtime);
      }
    }
  });

  it("offers the free period exactly once, marked as at-school", () => {
    const offsite = slotsForDate(MON).filter((s) => s.offSite);
    expect(offsite).toHaveLength(1);
    expect(toHm(offsite[0]?.start ?? 0)).toBe("14:46");
    expect(toHm(offsite[0]?.end ?? 0)).toBe("15:36");
  });

  it("gives practice days materially less time than non-practice days", () => {
    const mon = totalMinutes(slotsForDate(MON));
    const tue = totalMinutes(slotsForDate(TUE));
    expect(tue).toBeLessThan(mon);
    expect(mon - tue).toBeGreaterThan(60);
  });

  it("keeps the pre-school morning as the only weekday high-energy block", () => {
    const highs = slotsForDate(MON).filter((s) => s.energy === "high");
    expect(highs).toHaveLength(1);
    expect(toHm(highs[0]?.start ?? 0)).toBe("06:30");
  });

  it("produces a believable weekly capacity, not every waking hour", () => {
    const hours = totalMinutes(slotsForHorizon(MON, 7)) / 60;
    expect(hours).toBeGreaterThan(50);
    expect(hours).toBeLessThan(70);
  });
});
