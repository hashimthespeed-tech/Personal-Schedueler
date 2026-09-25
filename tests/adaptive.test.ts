import { describe, expect, it } from "vitest";
import { proposePlacements, type DayTemplate } from "../src/core/adaptive";

const day: DayTemplate = {
  date: "2026-09-21",
  wake: 360,
  workCutoff: 1260,
  bedtime: 1320,
  emergencyEnd: 1365,
  nextWake: 360,
  blocks: [
    { id: "school", title: "School", start: 510, end: 936, policy: "fixed" },
    { id: "prayer", title: "Prayer and shower", start: 960, end: 1000, policy: "protected" },
    { id: "workout", title: "Workout", start: 1020, end: 1080, policy: "flexible", minMinutes: 40, cost: "routine" },
    { id: "wind-down", title: "Before-sleep time", start: 1260, end: 1320, policy: "flexible", minMinutes: 0, cost: "winddown" },
  ],
};

describe("adaptive placement proposals", () => {
  it("fits an automatic item into open time after the requested earliest start", () => {
    const proposals = proposePlacements(day, {
      id: "homework", title: "Homework", durationMin: 45, kind: "school", mode: "auto", notBefore: 1000,
    });
    expect(proposals[0]).toMatchObject({ start: 1080, end: 1125, costs: [], remainingSleepMin: 480 });
  });

  it("shows exactly how much a fixed-time item shortens a flexible activity", () => {
    const proposals = proposePlacements(day, {
      id: "appointment", title: "Appointment", durationMin: 20, kind: "personal", mode: "fixed", at: 1040,
    });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.costs).toEqual([{ blockId: "workout", title: "Workout", type: "routine", lostMin: 20, remainingMin: 40 }]);
    expect(day.blocks[2]?.end).toBe(1080);
  });

  it("never places an item over school or prayer", () => {
    for (const at of [550, 970]) {
      expect(proposePlacements(day, {
        id: "appointment", title: "Appointment", durationMin: 20, kind: "personal", mode: "fixed", at,
      })).toEqual([]);
    }
  });

  it("uses sleep only for urgent next-day schoolwork and keeps at least seven hours", () => {
    const request = {
      id: "exam", title: "Exam prep", durationMin: 45, kind: "school" as const,
      mode: "fixed" as const, at: 1320,
    };
    expect(proposePlacements(day, request)).toEqual([]);
    expect(proposePlacements(day, { ...request, urgentDueTomorrow: true })[0]).toMatchObject({
      start: 1320, end: 1365, bedtime: 1365, remainingSleepMin: 435,
      costs: [{ type: "sleep", lostMin: 45 }],
    });
    expect(proposePlacements(day, { ...request, durationMin: 46, urgentDueTomorrow: true })).toEqual([]);
  });

  it("stops normal work at 9 PM and reports wind-down cost only for urgent schoolwork", () => {
    const request = { id: "late", title: "Late work", durationMin: 30, mode: "fixed" as const, at: 1275 };
    expect(proposePlacements(day, { ...request, kind: "personal" })).toEqual([]);
    expect(proposePlacements(day, { ...request, kind: "school" })).toEqual([]);
    expect(proposePlacements(day, { ...request, kind: "school", urgentDueTomorrow: true })[0]?.costs).toEqual([
      { blockId: "wind-down", title: "Before-sleep time", type: "winddown", lostMin: 30, remainingMin: 30 },
    ]);
  });

  it("treats period seven as friend time offered only for schoolwork", () => {
    const schoolDay: DayTemplate = {
      ...day,
      blocks: [
        { id: "classes", title: "Classes", start: 510, end: 886, policy: "fixed" },
        { id: "friends", title: "Friends in period 7", start: 886, end: 936, policy: "flexible", minMinutes: 0, cost: "friend", canUseFor: "school" },
      ],
    };
    const request = { id: "work", title: "Work", durationMin: 30, mode: "fixed" as const, at: 890 };
    expect(proposePlacements(schoolDay, { ...request, kind: "personal" })).toEqual([]);
    expect(proposePlacements(schoolDay, { ...request, kind: "school" })[0]?.costs).toEqual([
      { blockId: "friends", title: "Friends in period 7", type: "friend", lostMin: 30, remainingMin: 20 },
    ]);
  });

  it("offers a future slot for a past item and labels it overdue", () => {
    const proposals = proposePlacements(day, {
      id: "missed", title: "Missed item", durationMin: 30, kind: "personal", mode: "past", at: 900, notBefore: 1100,
    });
    expect(proposals[0]).toMatchObject({ start: 1100, overdue: true });
  });
});
