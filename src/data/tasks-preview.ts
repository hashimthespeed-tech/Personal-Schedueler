import { buildDayFrame } from "../core/day-frame";
import { recurringItemsForToday } from "../core/today-timeline";

export const tasksPreview = {
  date: "2026-09-21",
  frame: buildDayFrame("2026-09-21", { sleepMode: "current" }),
  recurring: recurringItemsForToday("2026-09-21", [{ slotKey: "fajr", status: "done" }]),
  tasks: [
    { id: 1, title: "Calculus review", onDate: "2026-09-21", durationMin: 45, startMin: 1005, kind: "school", status: "done", dueDate: "2026-09-22", movedToDate: null },
    { id: 2, title: "Read Quran", onDate: "2026-09-21", durationMin: 30, startMin: 1110, kind: "personal", status: "done", dueDate: null, movedToDate: null },
    { id: 4, title: "Spanish reading", onDate: "2026-09-21", durationMin: 25, startMin: null, kind: "school", status: "planned", dueDate: "2026-09-22", movedToDate: null },
    { id: 5, title: "History review", onDate: "2026-09-21", durationMin: 30, startMin: null, kind: "school", status: "moved", dueDate: "2026-09-23", movedToDate: "2026-09-22" },
  ],
};
