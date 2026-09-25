import { describe, expect, it } from "vitest";
import { buildDayFrame } from "../src/core/day-frame";
import { mergeWeekTimeline, weekDates, type WeekTask } from "../src/core/week";
import { recurringItemsForToday } from "../src/core/today-timeline";

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

  it("does not expose internal planner blocks in the actionable timeline", () => {
    const tasks: WeekTask[] = [
      { id: 9, title: "Visible task", onDate: frame.date, durationMin: 10, startMin: 1107, kind: "personal", status: "planned", dueDate: null, movedToDate: null, workRole: null },
    ];
    const entries = mergeWeekTimeline(frame, tasks);
    expect(entries.map((entry) => String(entry.type))).not.toContain("protected");
    expect(entries.map((entry) => entry.title)).toEqual(["Visible task"]);
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

  it("removes a task completed early from its future timed slot", () => {
    const tasks: WeekTask[] = [
      { id: 12, title: "Finished early", onDate: frame.date, durationMin: 30, startMin: 1100,
        kind: "school", status: "done", dueDate: null, movedToDate: null, workRole: "study",
        completedOn: "2026-09-21" },
    ];
    const entry = mergeWeekTimeline(frame, tasks).find((item) => item.id === "task-12");
    expect(entry).toMatchObject({ type: "completed", startMin: null, title: "Finished early" });
  });

  it("includes recurring commitments as checkable entries instead of planner anchors", () => {
    const recurring = recurringItemsForToday(frame.date, [{ slotKey: "fajr", status: "done" }]);
    const entries = mergeWeekTimeline(frame, [], recurring);
    expect(entries.find((entry) => entry.title === "Fajr")).toMatchObject({
      type: "recurring", recurring: { status: "done", slotKey: "fajr" },
    });
    expect(entries.some((entry) => entry.title === "Morning preparation")).toBe(false);
    expect(entries.some((entry) => entry.title === "Before-sleep time")).toBe(false);
  });
});
