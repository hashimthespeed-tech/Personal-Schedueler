import { describe, expect, it } from "vitest";
import { proposeSchoolworkTradeoffs, type PlanningDay } from "../src/core/schoolwork";

function pressuredDay(date: string): PlanningDay {
  return { notBefore: 960, template: { date, wake: 450, workCutoff: 1410, bedtime: 1410, emergencyEnd: 1470, nextWake: 450, blocks: [
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

  it("allows sleep only for schoolwork due the next day", () => {
    const day = pressuredDay("2026-09-22");
    const urgent = proposeSchoolworkTradeoffs({ id: "exam", title: "Exam", kind: "test", totalMin: 155,
      dueDate: "2026-09-23", selectedDates: ["2026-09-22"] }, [day]);
    expect(urgent.some((option) => option.costs.some((cost) => cost.type === "sleep"))).toBe(true);
    expect(urgent.every((option) => option.sessions.every((session) => session.placement.remainingSleepMin >= 0))).toBe(true);

    const notUrgent = proposeSchoolworkTradeoffs({ id: "essay", title: "Essay", kind: "assignment", totalMin: 155,
      dueDate: "2026-09-24", selectedDates: ["2026-09-22"] }, [day]);
    expect(notUrgent.some((option) => option.costs.some((cost) => cost.type === "sleep"))).toBe(false);
  });

  it("at 11 PM offers next-day work from the current time by cutting only remaining sleep", () => {
    const late: PlanningDay = { notBefore: 23 * 60, template: {
      date: "2026-09-22", wake: 360, workCutoff: 1260, bedtime: 1320, emergencyEnd: 1365, nextWake: 360,
      blocks: [
        { id: "workout", title: "Workout", start: 1050, end: 1080, policy: "flexible", minMinutes: 0, cost: "routine" },
        { id: "personal-focus", title: "Personal goal time", start: 1200, end: 1260,
          policy: "flexible", minMinutes: 40, cost: "routine" },
        { id: "wind-down", title: "Before-sleep time", start: 1260, end: 1320,
          policy: "flexible", minMinutes: 0, cost: "winddown", canUseFor: "school" },
      ],
    } };
    const options = proposeSchoolworkTradeoffs({ id: "due", title: "Due tomorrow", kind: "assignment", totalMin: 60,
      dueDate: "2026-09-23", selectedDates: ["2026-09-22"] }, [late]);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every((option) => option.costs.every((cost) => cost.type === "sleep"))).toBe(true);
    expect(options[0]?.title).toBe("Use 60 min of sleep");
    expect(options[0]?.sessions).toMatchObject([{ date: "2026-09-22", minutes: 60,
      placement: { start: 1380, end: 1440, remainingSleepMin: 360 } }]);
    expect(options[0]?.costs).toEqual([{ type: "sleep", lostMin: 60 }]);
  });

  it("uses only the unpassed part of sleep preparation before cutting sleep", () => {
    const late: PlanningDay = { notBefore: 21 * 60 + 30, template: {
      date: "2026-09-22", wake: 360, workCutoff: 1260, bedtime: 1320, emergencyEnd: 1365, nextWake: 360,
      blocks: [{ id: "wind-down", title: "Before-sleep time", start: 1260, end: 1320,
        policy: "flexible", minMinutes: 0, cost: "winddown", canUseFor: "school" }],
    } };
    const options = proposeSchoolworkTradeoffs({ id: "due", title: "Due tomorrow", kind: "assignment", totalMin: 60,
      dueDate: "2026-09-23", selectedDates: ["2026-09-22"] }, [late]);
    const option = options.find((candidate) => candidate.costs.some((cost) => cost.type === "winddown"));
    expect(option?.sessions).toMatchObject([
      { placement: { start: 1290, end: 1320 }, minutes: 30 },
      { placement: { start: 1320, end: 1350 }, minutes: 30 },
    ]);
    expect(option?.costs.map((cost) => ({ type: cost.type, lostMin: cost.lostMin }))).toEqual([
      { type: "winddown", lostMin: 30 }, { type: "sleep", lostMin: 30 },
    ]);
  });

  it("at 9 PM offers all before-sleep time first and only then uses sleep", () => {
    const atNine: PlanningDay = { notBefore: 21 * 60, template: {
      date: "2026-09-22", wake: 360, workCutoff: 1260, bedtime: 1320, emergencyEnd: 1365, nextWake: 360,
      blocks: [
        { id: "personal-focus", title: "Personal goal time", start: 1200, end: 1260,
          policy: "flexible", minMinutes: 40, cost: "routine" },
        { id: "wind-down", title: "Before-sleep time", start: 1260, end: 1320,
          policy: "flexible", minMinutes: 0, cost: "winddown", canUseFor: "school" },
      ],
    } };
    const options = proposeSchoolworkTradeoffs({ id: "due", title: "Due tomorrow", kind: "assignment", totalMin: 90,
      dueDate: "2026-09-23", selectedDates: ["2026-09-22"] }, [atNine]);
    expect(options[0]?.title).toBe("Use before-sleep time + 30 min less sleep");
    expect(options[0]?.sessions).toMatchObject([
      { minutes: 60, placement: { start: 1260, end: 1320 } },
      { minutes: 30, placement: { start: 1320, end: 1350 } },
    ]);
    expect(options[0]?.costs.map((cost) => ({ type: cost.type, lostMin: cost.lostMin }))).toEqual([
      { type: "winddown", lostMin: 60 }, { type: "sleep", lostMin: 30 },
    ]);
  });
});
