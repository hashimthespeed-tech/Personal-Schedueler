import { describe, expect, it } from "vitest";
import { buildCustomSchoolworkTradeoff, customTradeoffDraft, type PlanningDay } from "../src/core/schoolwork";

function day(date = "2026-09-22"): PlanningDay {
  return { notBefore: 450, template: { date, wake: 450, bedtime: 1410, nextWake: 450, blocks: [
    { id: "fixed-a", title: "Protected", start: 450, end: 1000, policy: "fixed" },
    { id: "short", title: "Study", start: 1000, end: 1030, policy: "flexible", minMinutes: 20, cost: "routine" },
    { id: "fixed-b", title: "Protected", start: 1030, end: 1100, policy: "fixed" },
    { id: "long", title: "Study", start: 1100, end: 1160, policy: "flexible", minMinutes: 20, cost: "routine" },
    { id: "fixed-c", title: "Protected", start: 1160, end: 1410, policy: "fixed" },
  ] } };
}

const request = { id: "work", title: "Urgent work", kind: "assignment" as const, totalMin: 30,
  dueDate: "2026-09-23", selectedDates: ["2026-09-22"] };

describe("custom schoolwork trade-offs", () => {
  it("keeps equal titles separate and derives each maximum from its own duration", () => {
    const draft = customTradeoffDraft(request, [day()]);
    expect(draft).not.toBeNull();
    expect(draft?.sources.filter((source) => source.type === "routine")).toEqual([
      { id: "2026-09-22:short", date: "2026-09-22", blockId: "short", title: "Study",
        type: "routine", originalMinutes: 30, minimumMinutes: 20, maxRemovable: 10 },
      { id: "2026-09-22:long", date: "2026-09-22", blockId: "long", title: "Study",
        type: "routine", originalMinutes: 60, minimumMinutes: 20, maxRemovable: 40 },
    ]);
  });

  it("builds only an exact, valid allocation and preserves the schoolwork total", () => {
    const allocation = [
      { sourceId: "2026-09-22:short", minutes: 10 },
      { sourceId: "2026-09-22:long", minutes: 20 },
    ];
    const option = buildCustomSchoolworkTradeoff(request, [day()], allocation);
    expect(option?.sessions.reduce((sum, session) => sum + session.minutes, 0)).toBe(30);
    expect(option?.costs.map((cost) => cost.lostMin)).toEqual([10, 20]);

    expect(buildCustomSchoolworkTradeoff(request, [day()], [{ sourceId: "2026-09-22:short", minutes: 15 },
      { sourceId: "2026-09-22:long", minutes: 15 }])).toBeNull();
    expect(buildCustomSchoolworkTradeoff(request, [day()], [{ sourceId: "2026-09-22:short", minutes: 10 },
      { sourceId: "2026-09-22:short", minutes: 20 }])).toBeNull();
    expect(buildCustomSchoolworkTradeoff(request, [day()], [{ sourceId: "2026-09-22:short", minutes: 10 },
      { sourceId: "2026-09-22:long", minutes: 15 }])).toBeNull();
  });

  it("derives sleep from that night's actual plan and retains seven hours", () => {
    const draft = customTradeoffDraft({ ...request, totalMin: 70 }, [day()]);
    expect(draft?.sources.find((source) => source.type === "sleep")).toEqual({
      id: "2026-09-22:sleep", date: "2026-09-22", title: "Sleep", type: "sleep",
      originalMinutes: 480, minimumMinutes: 420, maxRemovable: 60,
    });
    const option = buildCustomSchoolworkTradeoff({ ...request, totalMin: 70 }, [day()], [
      { sourceId: "2026-09-22:short", minutes: 10 },
      { sourceId: "2026-09-22:long", minutes: 40 },
      { sourceId: "2026-09-22:sleep", minutes: 20 },
    ]);
    expect(option?.sessions.every((session) => session.placement.remainingSleepMin >= 420)).toBe(true);
  });
});
