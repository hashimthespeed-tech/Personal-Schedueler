import { describe, expect, it } from "vitest";
import { assessFiniteGoal, assessMonthlyGoal, finishGoal, type Goal, type GoalEntry } from "../src/core/goals";

const calories: Goal = {
  id: 1, category: "fitness", title: "Eat enough", kind: "ongoing", measure: "daily-number",
  target: 2800, comparison: "at-least", unit: "cal", allowedMisses: 2, createdOn: "2026-09-01",
};

describe("goal progress", () => {
  it("shows monthly consistency and remaining lives without treating unknown days as misses", () => {
    const entries: GoalEntry[] = [
      { goalId: 1, onDate: "2026-09-01", value: 2900 },
      { goalId: 1, onDate: "2026-09-02", value: 2600 },
      { goalId: 1, onDate: "2026-09-03", value: 2810 },
    ];
    expect(assessMonthlyGoal(calories, entries, "2026-09-04")).toMatchObject({
      metDays: 2, missedDays: 1, unloggedDays: 1, livesRemaining: 1, completed: false,
      points: [
        { date: "2026-09-01", value: 2900, met: true },
        { date: "2026-09-02", value: 2600, met: false },
        { date: "2026-09-03", value: 2810, met: true },
      ],
    });
  });

  it("resets lives in a new month while keeping the ongoing goal active", () => {
    const entries: GoalEntry[] = [
      { goalId: 1, onDate: "2026-09-30", value: 2100 },
      { goalId: 1, onDate: "2026-10-01", value: 2700 },
    ];
    expect(assessMonthlyGoal(calories, entries, "2026-10-01")).toMatchObject({
      metDays: 0, missedDays: 1, livesRemaining: 1, completed: false,
    });
  });

  it("completes a finite cumulative goal and preserves its history when archived", () => {
    const quran: Goal = {
      id: 2, category: "religion", title: "Read Quran", kind: "finite", measure: "sum",
      target: 100, comparison: "at-least", unit: "pages", createdOn: "2026-09-01",
    };
    const entries: GoalEntry[] = [
      { goalId: 2, onDate: "2026-09-01", value: 40 },
      { goalId: 2, onDate: "2026-09-03", value: 60 },
    ];
    expect(assessFiniteGoal(quran, entries)).toMatchObject({ value: 100, progress: 1, reached: true });
    expect(finishGoal(quran, entries, "2026-09-03")).toMatchObject({
      goal: { completedOn: "2026-09-03" }, entries,
    });
  });

  it("supports latest-value goals without adding measurements together", () => {
    const weight: Goal = {
      id: 3, category: "fitness", title: "Reach target weight", kind: "finite", measure: "latest",
      target: 145, comparison: "at-least", unit: "lb", createdOn: "2026-09-01", startValue: 130,
    };
    const entries: GoalEntry[] = [
      { goalId: 3, onDate: "2026-09-01", value: 130 },
      { goalId: 3, onDate: "2026-09-20", value: 140 },
    ];
    expect(assessFiniteGoal(weight, entries)).toMatchObject({ value: 140, progress: 2 / 3, reached: false });
  });
});
