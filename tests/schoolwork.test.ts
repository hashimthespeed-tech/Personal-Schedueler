import { describe, expect, it } from "vitest";
import { planSchoolwork, suggestWorkdays, type PlanningDay } from "../src/core/schoolwork";

function available(date: string, start = 960, end = 1320): PlanningDay {
  return {
    template: { date, wake: 450, bedtime: 1410, nextWake: 450, blocks: [
      { id: `busy-${date}`, title: "Busy", start: 450, end: start, policy: "fixed" },
      { id: `late-${date}`, title: "Late", start: end, end: 1410, policy: "fixed" },
    ] },
    notBefore: start,
  };
}

describe("schoolwork planning", () => {
  it("suggests only days before the deadline, with usable minutes", () => {
    const days = [available("2026-09-21"), available("2026-09-22", 960, 990), available("2026-09-23")];
    expect(suggestWorkdays(days, "2026-09-23")).toEqual([
      { date: "2026-09-21", availableMin: 120 },
      { date: "2026-09-22", availableMin: 30 },
    ]);
  });

  it("spreads an assignment across chosen days and moves overflow to a day with room", () => {
    const result = planSchoolwork({
      id: "essay", title: "Essay", kind: "assignment", totalMin: 150,
      dueDate: "2026-09-23", selectedDates: ["2026-09-21", "2026-09-22"],
    }, [available("2026-09-21"), available("2026-09-22", 960, 990)]);
    expect(result).toMatchObject({ ok: true, sessions: [
      { date: "2026-09-21", minutes: 120 },
      { date: "2026-09-22", minutes: 30 },
    ] });
  });

  it("rejects an overloaded selection and reports the shortage", () => {
    const result = planSchoolwork({
      id: "essay", title: "Essay", kind: "assignment", totalMin: 170,
      dueDate: "2026-09-23", selectedDates: ["2026-09-21", "2026-09-22"],
    }, [available("2026-09-21"), available("2026-09-22", 960, 990)]);
    expect(result).toEqual({ ok: false, reason: "insufficient-time", shortfallMin: 20 });
  });

  it("rejects a chosen day on or after the due date", () => {
    expect(planSchoolwork({
      id: "work", title: "Work", kind: "assignment", totalMin: 30,
      dueDate: "2026-09-22", selectedDates: ["2026-09-22"],
    }, [available("2026-09-22")])).toEqual({ ok: false, reason: "invalid-days" });
  });

  it("requires exactly two test days including a refresher the day before", () => {
    const request = {
      id: "math-test", title: "Math test", kind: "test" as const, totalMin: 120,
      dueDate: "2026-09-23", selectedDates: ["2026-09-21", "2026-09-22"],
    };
    const days = [available("2026-09-21"), available("2026-09-22")];
    expect(planSchoolwork(request, days)).toMatchObject({ ok: true, sessions: [
      { date: "2026-09-21", minutes: 90, role: "study" },
      { date: "2026-09-22", minutes: 30, role: "refresher" },
    ] });
    expect(planSchoolwork({ ...request, selectedDates: ["2026-09-20", "2026-09-21"] }, [available("2026-09-20"), ...days]))
      .toEqual({ ok: false, reason: "test-days" });
  });
});
