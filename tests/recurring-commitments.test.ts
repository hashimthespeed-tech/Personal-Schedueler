import { describe, expect, it } from "vitest";
import { prayerBlocks } from "../src/core/prayer";
import {
  recurringCommitmentFor,
  recurringCommitmentsFor,
} from "../src/core/recurring-commitments";

function byKey(date: string, slotKey: string) {
  return recurringCommitmentsFor(date).find((item) => item.slotKey === slotKey);
}

describe("recurring commitments", () => {
  it("uses the same fixed daily prayer times every day", () => {
    for (const date of ["2026-09-21", "2026-09-26", "2026-12-21"]) {
      expect(byKey(date, "fajr")).toMatchObject({
        title: "Fajr",
        start: 365,
        end: 377,
        kind: "prayer",
        plannerPolicy: "protected",
      });
      expect(byKey(date, "maghrib-isha")).toMatchObject({
        title: "Maghrib + Isha",
        start: 1140,
        end: 1152,
        kind: "prayer",
        plannerPolicy: "protected",
      });
    }
  });

  it("places Dhuhr + Asr after the weekday arrival buffer", () => {
    expect(byKey("2026-09-21", "dhuhr-asr")).toMatchObject({ start: 985, end: 997 });
    expect(byKey("2026-09-22", "dhuhr-asr")).toMatchObject({ start: 1095, end: 1107 });
    expect(byKey("2026-09-25", "dhuhr-asr")).toMatchObject({ start: 979, end: 991 });
  });

  it("uses the calculated Dhuhr time when there is no school", () => {
    for (const date of ["2026-09-26", "2026-12-21"]) {
      const calculated = prayerBlocks(date).find((block) => block.name === "dhuhr-asr")!;
      expect(byKey(date, "dhuhr-asr")).toMatchObject({
        start: calculated.start,
        end: calculated.start + 12,
      });
    }
  });

  it("shows wrestling only on Tuesday and Thursday school days", () => {
    expect(byKey("2026-09-22", "wrestling")).toMatchObject({
      title: "Wrestling",
      start: 936,
      end: 1050,
      kind: "wrestling",
      plannerPolicy: "fixed",
    });
    expect(byKey("2026-09-24", "wrestling")).toBeDefined();
    expect(byKey("2026-09-21", "wrestling")).toBeUndefined();
    expect(byKey("2026-12-22", "wrestling")).toBeUndefined();
  });

  it("shows a flexible 30-minute workout on Monday, Friday, Saturday, and Sunday", () => {
    for (const date of ["2026-09-21", "2026-09-25", "2026-09-26", "2026-09-27"]) {
      expect(byKey(date, "workout")).toMatchObject({
        title: "Workout",
        start: 1050,
        end: 1080,
        kind: "workout",
        plannerPolicy: "flexible",
      });
    }
    for (const date of ["2026-09-22", "2026-09-23", "2026-09-24"]) {
      expect(byKey(date, "workout")).toBeUndefined();
    }
  });

  it("keeps slot keys unique and validates a slot against its date", () => {
    const monday = recurringCommitmentsFor("2026-09-21");
    expect(new Set(monday.map((item) => item.slotKey)).size).toBe(monday.length);
    expect(recurringCommitmentFor("2026-09-21", "workout")?.title).toBe("Workout");
    expect(recurringCommitmentFor("2026-09-23", "workout")).toBeNull();
    expect(() => recurringCommitmentsFor("not-a-date")).toThrow("valid ISO date");
  });
});
