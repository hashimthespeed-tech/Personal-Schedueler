import { describe, expect, it } from "vitest";
import { proposeSchoolworkTradeoffs, type PlanningDay } from "../src/core/schoolwork";

function pressuredDay(date: string): PlanningDay {
  return { notBefore: 960, template: { date, wake: 450, bedtime: 1410, nextWake: 450, blocks: [
    { id: "busy", title: "Busy", start: 450, end: 1000, policy: "fixed" },
    { id: "friend", title: "Friends in period 7", start: 1000, end: 1050, policy: "flexible", minMinutes: 0, cost: "friend", canUseFor: "school" },
    { id: "busy-2", title: "Busy", start: 1050, end: 1200, policy: "fixed" },
    { id: "workout", title: "Workout", start: 1200, end: 1260, policy: "flexible", minMinutes: 40, cost: "routine" },
    { id: "focus", title: "Personal goal time", start: 1260, end: 1320, policy: "flexible", minMinutes: 40, cost: "routine" },
    { id: "busy-3", title: "Busy", start: 1320, end: 1365, policy: "fixed" },
    { id: "wind-down", title: "Wind-down", start: 1365, end: 1410, policy: "flexible", minMinutes: 20, cost: "winddown" },
  ] } };
}

describe("schoolwork trade-off options", () => {
  it("offers distinct choices and every choice totals the original estimate", () => {
    const request = { id: "exam", title: "Exam prep", kind: "test" as const, totalMin: 90,
      dueDate: "2026-09-23", selectedDates: ["2026-09-22"] };
    const options = proposeSchoolworkTradeoffs(request, [pressuredDay("2026-09-22")]);
    expect(options.length).toBeGreaterThanOrEqual(2);
    for (const option of options) {
      expect(option.sessions.reduce((sum, session) => sum + session.minutes, 0)).toBe(90);
    }
    expect(options.some((option) => option.costs.some((cost) => cost.type === "friend"))).toBe(true);
    expect(options.some((option) =>
      JSON.stringify(option.costs.filter((cost) => cost.type === "routine").map((cost) => cost.lostMin)) === JSON.stringify([10, 10])))
      .toBe(true);
  });

  it("allows sleep only for schoolwork due the next day and never below seven hours", () => {
    const day = pressuredDay("2026-09-22");
    const urgent = proposeSchoolworkTradeoffs({ id: "exam", title: "Exam", kind: "test", totalMin: 155,
      dueDate: "2026-09-23", selectedDates: ["2026-09-22"] }, [day]);
    expect(urgent.some((option) => option.costs.some((cost) => cost.type === "sleep"))).toBe(true);
    expect(urgent.every((option) => option.sessions.every((session) => session.placement.remainingSleepMin >= 420))).toBe(true);

    const notUrgent = proposeSchoolworkTradeoffs({ id: "essay", title: "Essay", kind: "assignment", totalMin: 155,
      dueDate: "2026-09-24", selectedDates: ["2026-09-22"] }, [day]);
    expect(notUrgent.some((option) => option.costs.some((cost) => cost.type === "sleep"))).toBe(false);
  });
});
