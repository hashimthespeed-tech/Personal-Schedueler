import { buildDayFrame } from "../core/day-frame";
import { weekDates, type WeekTask } from "../core/week";
import { recurringItemsForToday } from "../core/today-timeline";

const dates = weekDates("2026-09-22");
const tasks: WeekTask[] = [
  { id: 101, title: "Spanish reading", onDate: "2026-09-21", durationMin: 45, startMin: 960, kind: "school", status: "done", dueDate: "2026-09-23", movedToDate: null, workRole: "study" },
  { id: 102, title: "Calculus review", onDate: "2026-09-22", durationMin: 60, startMin: 1107, kind: "school", status: "done", dueDate: "2026-09-24", movedToDate: null, workRole: "study", completedOn: "2026-09-21" },
  { id: 107, title: "APUSH essay · sleep restored", onDate: "2026-09-22", durationMin: 60, startMin: 1107, kind: "school", status: "planned", dueDate: "2026-09-23", movedToDate: null, workRole: "study" },
  { id: 103, title: "Calculus review · part 2", onDate: "2026-09-23", durationMin: 60, startMin: 1020, kind: "school", status: "planned", dueDate: "2026-09-24", movedToDate: null, workRole: "study" },
  { id: 104, title: "APUSH notes", onDate: "2026-09-22", durationMin: 30, startMin: null, kind: "school", status: "planned", dueDate: "2026-09-23", movedToDate: null, workRole: "study" },
  { id: 105, title: "Quran study", onDate: "2026-09-24", durationMin: 30, startMin: 1200, kind: "personal", status: "planned", dueDate: null, movedToDate: null, workRole: null },
  { id: 106, title: "Workout", onDate: "2026-09-21", durationMin: 40, startMin: 1170, kind: "personal", status: "moved", dueDate: null, movedToDate: "2026-09-23", workRole: null },
];

export const weekPreview = {
  ok: true as const,
  weekStart: dates[0]!,
  weekEnd: dates[6]!,
  days: dates.map((date) => ({
    date,
    frame: buildDayFrame(date, { sleepMode: "current" }),
    tasks: tasks.filter((task) => task.onDate === date),
    recurring: recurringItemsForToday(date, date === "2026-09-22" ? [{ slotKey: "fajr", status: "done" }] : []),
  })),
};
