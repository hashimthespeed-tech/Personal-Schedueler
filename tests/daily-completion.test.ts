import { describe, expect, it } from "vitest";
import { scoreDay, scoreRange, type AssignedTask } from "../src/core/daily-completion";

const tasks: AssignedTask[] = [
  { id: "a", date: "2026-09-20", title: "Homework", status: "done" },
  { id: "b", date: "2026-09-20", title: "Workout", status: "planned" },
  { id: "c", date: "2026-09-20", title: "Quran", status: "moved" },
  { id: "d", date: "2026-09-20", title: "Old plan", status: "cancelled" },
  { id: "e", date: "2026-09-21", title: "Quran", status: "done" },
];

describe("daily task completion", () => {
  it("excludes approved moves and cancellations from the denominator", () => {
    expect(scoreDay("2026-09-20", tasks)).toEqual({
      date: "2026-09-20", assigned: 2, completed: 1, moved: 1, cancelled: 1, percent: 50,
    });
  });

  it("reports no percentage for a day with no assigned tasks", () => {
    expect(scoreDay("2026-09-19", tasks)).toMatchObject({ assigned: 0, percent: null });
  });

  it("calculates a point for every day, including days with no work", () => {
    expect(scoreRange("2026-09-19", "2026-09-21", tasks).map((day) => day.percent)).toEqual([null, 50, 100]);
  });

  it("rejects invalid ranges rather than drawing a misleading graph", () => {
    expect(() => scoreRange("2026-09-22", "2026-09-21", tasks)).toThrow();
  });
});
