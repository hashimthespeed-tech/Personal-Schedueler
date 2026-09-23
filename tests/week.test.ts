import { describe, expect, it } from "vitest";
import { buildDayFrame } from "../src/core/day-frame";
import { mergeWeekTimeline, weekDates, type WeekTask } from "../src/core/week";

describe("week dates", () => {
  it("returns Monday through Sunday around a Tuesday", () => {
    expect(weekDates("2026-09-22")).toEqual([
      "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24",
      "2026-09-25", "2026-09-26", "2026-09-27",
    ]);
  });

  it("crosses month boundaries without changing order", () => {
    expect(weekDates("2026-10-01")).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01",
      "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
  });
});

describe("week timeline", () => {
  const frame = buildDayFrame("2026-09-22", { sleepMode: "current" });

  it("keeps same-named tasks separate by id", () => {
    const tasks: WeekTask[] = [
      { id: 7, title: "Study", onDate: frame.date, durationMin: 30, startMin: 1000, kind: "school", status: "planned", dueDate: null, movedToDate: null, workRole: null },
      { id: 8, title: "Study", onDate: frame.date, durationMin: 60, startMin: 1100, kind: "school", status: "planned", dueDate: null, movedToDate: null, workRole: null },
    ];
    const taskEntries = mergeWeekTimeline(frame, tasks).filter((entry) => entry.type === "task");
    expect(taskEntries.map((entry) => entry.id)).toEqual(["task-7", "task-8"]);
    expect(taskEntries.map((entry) => entry.durationMin)).toEqual([30, 60]);
  });

  it("places a protected anchor before a task at the same minute", () => {
    const anchor = frame.blocks.find((block) => block.policy === "protected")!;
    const tasks: WeekTask[] = [
      { id: 9, title: "Collision", onDate: frame.date, durationMin: 10, startMin: anchor.start, kind: "personal", status: "planned", dueDate: null, movedToDate: null, workRole: null },
    ];
    const atMinute = mergeWeekTimeline(frame, tasks).filter((entry) => entry.startMin === anchor.start);
    expect(atMinute.map((entry) => entry.type)).toEqual(["protected", "task"]);
  });

  it("separates overdue and moved history from timed entries", () => {
    const tasks: WeekTask[] = [
      { id: 10, title: "Late", onDate: frame.date, durationMin: 20, startMin: null, kind: "personal", status: "planned", dueDate: null, movedToDate: null, workRole: null },
      { id: 11, title: "Moved", onDate: frame.date, durationMin: 20, startMin: 900, kind: "personal", status: "moved", dueDate: null, movedToDate: "2026-09-23", workRole: null },
    ];
    const entries = mergeWeekTimeline(frame, tasks);
    expect(entries.find((entry) => entry.id === "task-10")?.type).toBe("overdue");
    expect(entries.find((entry) => entry.id === "task-11")?.type).toBe("moved");
  });

  it("groups the fixed school schedule into one readable anchor", () => {
    const entries = mergeWeekTimeline(frame, []);
    expect(entries.filter((entry) => entry.id === "block-school-day")).toHaveLength(1);
    expect(entries.some((entry) => entry.title === "Break")).toBe(false);
    expect(entries.some((entry) => entry.title.startsWith("P1 "))).toBe(false);
  });
});
