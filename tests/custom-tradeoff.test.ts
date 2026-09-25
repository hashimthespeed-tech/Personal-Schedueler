import { describe, expect, it } from "vitest";
import { buildCustomSchoolworkTradeoff, customTradeoffDraft, type PlanningDay } from "../src/core/schoolwork";

function day(date = "2026-09-22"): PlanningDay {
  return { notBefore: 450, template: { date, wake: 450, workCutoff: 1410, bedtime: 1410, emergencyEnd: 1470, nextWake: 450, blocks: [
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
  it("fills an odd-minute shortfall without rounding the sacrifice", () => {
    const exactRequest = { ...request, totalMin: 1 };
    const draft = customTradeoffDraft(exactRequest, [day()]);
    expect(draft?.requiredMinutes).toBe(1);
    const option = buildCustomSchoolworkTradeoff(exactRequest, [day()], [
      { sourceId: "2026-09-22:short", minutes: 1 },
    ]);
    expect(option?.sessions.reduce((sum, session) => sum + session.minutes, 0)).toBe(1);
    expect(option?.costs).toMatchObject([{ blockId: "short", lostMin: 1, remainingMin: 29 }]);
  });

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

  it("derives all of that night's sleep as an explicit next-day emergency option", () => {
    const draft = customTradeoffDraft({ ...request, totalMin: 70 }, [day()]);
    expect(draft?.sources.find((source) => source.type === "sleep")).toEqual({
      id: "2026-09-22:sleep", date: "2026-09-22", title: "Sleep", type: "sleep",
      originalMinutes: 480, minimumMinutes: 0, maxRemovable: 480,
    });
    const option = buildCustomSchoolworkTradeoff({ ...request, totalMin: 70 }, [day()], [
      { sourceId: "2026-09-22:short", minutes: 10 },
      { sourceId: "2026-09-22:long", minutes: 40 },
      { sourceId: "2026-09-22:sleep", minutes: 20 },
    ]);
    expect(option?.sessions.every((session) => session.placement.remainingSleepMin >= 420)).toBe(true);
  });

  it("derives a late-night sleep source from now until wake-up", () => {
    const late = day();
    late.notBefore = 1380;
    late.template.bedtime = 1320;
    late.template.nextWake = 360;
    late.template.emergencyEnd = 1365;
    late.template.blocks = late.template.blocks.filter((block) => block.end <= 1320);
    const draft = customTradeoffDraft({ ...request, totalMin: 60 }, [late]);
    expect(draft?.sources.find((source) => source.type === "sleep")).toMatchObject({
      id: "2026-09-22:sleep", originalMinutes: 420, minimumMinutes: 0, maxRemovable: 420,
    });
  });
});
