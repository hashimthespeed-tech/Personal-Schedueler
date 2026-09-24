import { describe, expect, it } from "vitest";
import { planSchoolwork, recommendWorkdays, suggestWorkdays, type PlanningDay } from "../src/core/schoolwork";

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
  it("accepts one-minute assignments and preserves the exact total", () => {
    const result = planSchoolwork({
      id: "quick-question", title: "Quick question", kind: "assignment", totalMin: 1,
      dueDate: "2026-09-22", selectedDates: ["2026-09-21"],
    }, [available("2026-09-21")]);
    expect(result).toMatchObject({ ok: true, sessions: [
      { date: "2026-09-21", minutes: 1, placement: { start: 960, end: 961 } },
    ] });
  });

  it("splits odd-minute assignments without rounding or duplicating time", () => {
    const result = planSchoolwork({
      id: "worksheet", title: "Worksheet", kind: "assignment", totalMin: 17,
      dueDate: "2026-09-23", selectedDates: ["2026-09-21", "2026-09-22"],
    }, [available("2026-09-21"), available("2026-09-22")]);
    expect(result).toMatchObject({ ok: true, sessions: [
      { date: "2026-09-21", minutes: 9 },
      { date: "2026-09-22", minutes: 8 },
    ] });
    if (result.ok) expect(result.sessions.reduce((sum, session) => sum + session.minutes, 0)).toBe(17);
  });

  it("keeps the two-day test rule for short exact-minute estimates", () => {
    const days = [available("2026-09-21"), available("2026-09-22")];
    expect(recommendWorkdays(days, "2026-09-23", 2, "test")).toEqual(["2026-09-21", "2026-09-22"]);
    expect(planSchoolwork({
      id: "quiz", title: "Quiz", kind: "test", totalMin: 2,
      dueDate: "2026-09-23", selectedDates: ["2026-09-21", "2026-09-22"],
    }, days)).toMatchObject({ ok: true, sessions: [
      { date: "2026-09-21", minutes: 1, role: "study" },
      { date: "2026-09-22", minutes: 1, role: "refresher" },
    ] });
  });

  it("still rejects zero and fractional estimates", () => {
    const base = { id: "work", title: "Work", kind: "assignment" as const,
      dueDate: "2026-09-22", selectedDates: ["2026-09-21"] };
    expect(planSchoolwork({ ...base, totalMin: 0 }, [available("2026-09-21")]))
      .toEqual({ ok: false, reason: "invalid-duration" });
    expect(planSchoolwork({ ...base, totalMin: 1.5 }, [available("2026-09-21")]))
      .toEqual({ ok: false, reason: "invalid-duration" });
  });

  it("recommends the latest available days before an assignment deadline", () => {
    const options = [available("2026-09-21"), available("2026-09-22"), available("2026-09-23")];
    expect(recommendWorkdays(options, "2026-09-24", 180, "assignment")).toEqual(["2026-09-22", "2026-09-23"]);
  });

  it("recommends two test days with a day-before refresher", () => {
    const options = [available("2026-09-21"), available("2026-09-22"), available("2026-09-23")];
    expect(recommendWorkdays(options, "2026-09-24", 120, "test")).toEqual(["2026-09-22", "2026-09-23"]);
  });

  it("uses two separate open windows without exceeding the daily workload cap", () => {
    const day = available("2026-09-21", 960, 1090);
    day.template.blocks.push({ id: "meeting", title: "Meeting", start: 1020, end: 1030, policy: "fixed" });
    expect(suggestWorkdays([day], "2026-09-22")).toEqual([{ date: "2026-09-21", availableMin: 120 }]);
    const plan = planSchoolwork({ id: "essay", title: "Essay", kind: "assignment", totalMin: 120,
      dueDate: "2026-09-22", selectedDates: ["2026-09-21"] }, [day]);
    expect(plan).toMatchObject({ ok: true, sessions: [
      { date: "2026-09-21", minutes: 60, placement: { start: 960, end: 1020 } },
      { date: "2026-09-21", minutes: 60, placement: { start: 1030, end: 1090 } },
    ] });
  });

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

  it("treats estimated minutes as one total across the selected days", () => {
    const request = { id: "homework", title: "Homework", kind: "assignment" as const,
      totalMin: 120, dueDate: "2026-09-23", selectedDates: ["2026-09-21", "2026-09-22"] };
    const even = planSchoolwork(request, [available("2026-09-21"), available("2026-09-22")]);
    expect(even).toMatchObject({ ok: true, sessions: [
      { date: "2026-09-21", minutes: 60 }, { date: "2026-09-22", minutes: 60 },
    ] });
    if (even.ok) expect(even.sessions.reduce((sum, session) => sum + session.minutes, 0)).toBe(120);

    const uneven = planSchoolwork(request, [available("2026-09-21", 960, 990), available("2026-09-22")]);
    expect(uneven).toMatchObject({ ok: true, sessions: [
      { date: "2026-09-21", minutes: 30 }, { date: "2026-09-22", minutes: 90 },
    ] });
    if (uneven.ok) expect(uneven.sessions.reduce((sum, session) => sum + session.minutes, 0)).toBe(120);
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
