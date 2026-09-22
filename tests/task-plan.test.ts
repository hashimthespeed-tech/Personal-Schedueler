import { describe, expect, it } from "vitest";
import { buildDayFrame } from "../src/core/day-frame";
import { previewTask, type ExistingTask } from "../src/core/task-plan";

const monday = buildDayFrame("2026-09-21", { sleepMode: "current" });
const existing: ExistingTask[] = [
  { id: "1", title: "Homework", start: 1010, end: 1070, status: "planned" },
];

describe("quick-add task preview", () => {
  it("offers a free slot after the current time without colliding with saved work", () => {
    const options = previewTask(monday, { title: "Read", durationMin: 30, kind: "personal", mode: "auto" }, existing, 1000);
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]!.start).toBeGreaterThanOrEqual(1070);
    expect(options[0]!.costs).toEqual([]);
  });

  it("shows the cost of using friend time for schoolwork", () => {
    const options = previewTask(monday, { title: "Study", durationMin: 30, kind: "school", mode: "fixed", at: 890 }, [], 800);
    expect(options[0]).toMatchObject({ start: 890, costs: [{ type: "friend", lostMin: 30 }] });
  });

  it("never puts personal work in period seven", () => {
    const options = previewTask(monday, { title: "Workout", durationMin: 30, kind: "personal", mode: "fixed", at: 890 }, [], 800);
    expect(options).toEqual([]);
  });

  it("places a passed item in the overdue tray without inventing a new time", () => {
    const options = previewTask(monday, { title: "Missed call", durationMin: 20, kind: "personal", mode: "past" }, [], 1000);
    expect(options).toEqual([{ start: null, end: null, overdue: true, costs: [], remainingSleepMin: 480 }]);
  });

  it("refuses a fixed time that has already passed", () => {
    expect(previewTask(monday, { title: "Read", durationMin: 20, kind: "personal", mode: "fixed", at: 990 }, [], 1000)).toEqual([]);
  });
});
