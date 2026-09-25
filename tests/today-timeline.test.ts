import { describe, expect, it } from "vitest";
import { mergeTodayTimeline, recurringItemsForToday } from "../src/core/today-timeline";

const tasks = [
  { id: 1, title: "Later task", onDate: "2026-09-21", durationMin: 20, startMin: 1100,
    kind: "personal", status: "planned", dueDate: null, movedToDate: null },
  { id: 2, title: "Early task", onDate: "2026-09-21", durationMin: 15, startMin: 400,
    kind: "school", status: "done", dueDate: "2026-09-22", movedToDate: null },
  { id: 3, title: "Overdue", onDate: "2026-09-21", durationMin: 10, startMin: null,
    kind: "school", status: "planned", dueDate: null, movedToDate: null },
  { id: 4, title: "Moved", onDate: "2026-09-21", durationMin: 10, startMin: 500,
    kind: "personal", status: "moved", dueDate: null, movedToDate: "2026-09-22" },
];

describe("Today timeline", () => {
  it("maps routine marks onto date-specific recurring items", () => {
    const recurring = recurringItemsForToday("2026-09-21", [
      { slotKey: "fajr", status: "done" },
      { slotKey: "unrelated-legacy-slot", status: "done" },
    ]);
    expect(recurring.find((item) => item.slotKey === "fajr")).toMatchObject({
      id: "recurring:2026-09-21:fajr", status: "done", durationMin: 12,
    });
    expect(recurring.find((item) => item.slotKey === "workout")).toMatchObject({
      id: "recurring:2026-09-21:workout", status: "planned", durationMin: 30,
    });
  });

  it("merges active timed tasks and recurring items chronologically", () => {
    const recurring = recurringItemsForToday("2026-09-21", []);
    const timeline = mergeTodayTimeline(tasks, recurring);
    expect(timeline.map((entry) => entry.id)).toEqual([
      "recurring:2026-09-21:fajr",
      "task:2",
      "recurring:2026-09-21:dhuhr-asr",
      "recurring:2026-09-21:workout",
      "task:1",
      "recurring:2026-09-21:maghrib-isha",
    ]);
    expect(timeline.some((entry) => entry.title === "Overdue")).toBe(false);
    expect(timeline.some((entry) => entry.title === "Moved")).toBe(false);
  });

  it("keeps each source identifiable so recurring cards cannot be moved", () => {
    const timeline = mergeTodayTimeline(tasks, recurringItemsForToday("2026-09-21", []));
    expect(timeline.find((entry) => entry.id === "task:1")?.source).toBe("task");
    expect(timeline.find((entry) => entry.id.endsWith(":workout"))?.source).toBe("recurring");
  });
});
