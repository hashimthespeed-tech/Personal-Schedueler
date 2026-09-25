import { DateTime } from "luxon";
import { recurringCommitmentsFor } from "./recurring-commitments";

export type AssignedTaskStatus = "planned" | "done" | "moved" | "cancelled";

/** Only actionable tasks belong here; classes, commutes, and sleep are not tasks. */
export interface AssignedTask {
  id: string;
  date: string;
  title: string;
  status: AssignedTaskStatus;
}

export interface DailyCompletion {
  date: string;
  assigned: number;
  completed: number;
  moved: number;
  cancelled: number;
  percent: number | null;
}

export interface RecurringCompletionMark {
  onDate: string;
  slotKey: string;
  status: string;
}

/** Build graph inputs without retroactively inventing saved daily task rows. */
export function recurringAssignedTasks(from: string, through: string, marks: RecurringCompletionMark[],
  trackingStart = from): AssignedTask[] {
  const done = new Set(marks.filter((mark) => mark.status === "done")
    .map((mark) => `${mark.onDate}:${mark.slotKey}`));
  const tasks: AssignedTask[] = [];
  for (let day = DateTime.fromISO(from); day <= DateTime.fromISO(through); day = day.plus({ days: 1 })) {
    const date = day.toISODate()!;
    if (date < trackingStart) continue;
    for (const item of recurringCommitmentsFor(date)) {
      tasks.push({ id: `recurring:${date}:${item.slotKey}`, date, title: item.title,
        status: done.has(`${date}:${item.slotKey}`) ? "done" : "planned" });
    }
  }
  return tasks;
}

export function scoreDay(date: string, tasks: AssignedTask[]): DailyCompletion {
  const today = tasks.filter((task) => task.date === date);
  const completed = today.filter((task) => task.status === "done").length;
  const moved = today.filter((task) => task.status === "moved").length;
  const cancelled = today.filter((task) => task.status === "cancelled").length;
  const assigned = today.length - moved - cancelled;
  return {
    date, assigned, completed, moved, cancelled,
    percent: assigned === 0 ? null : Math.round((completed / assigned) * 100),
  };
}

export function scoreRange(from: string, through: string, tasks: AssignedTask[]): DailyCompletion[] {
  const start = DateTime.fromISO(from);
  const end = DateTime.fromISO(through);
  if (!start.isValid || !end.isValid || start.toISODate() !== from || end.toISODate() !== through || start > end) {
    throw new Error("A valid ascending date range is required.");
  }
  const result: DailyCompletion[] = [];
  for (let day = start; day <= end; day = day.plus({ days: 1 })) {
    result.push(scoreDay(day.toISODate()!, tasks));
  }
  return result;
}
