import { DateTime } from "luxon";
import type { DayTemplate } from "./adaptive";
import type { TodayRecurringItem } from "./today-timeline";

export interface WeekTask {
  id: number;
  title: string;
  onDate: string;
  durationMin: number;
  startMin: number | null;
  kind: string;
  status: string;
  dueDate: string | null;
  movedToDate: string | null;
  workRole: string | null;
  completedOn?: string | null;
}

export interface WeekTimelineEntry {
  id: string;
  type: "task" | "recurring" | "overdue" | "moved" | "completed";
  title: string;
  startMin: number | null;
  durationMin: number;
  task?: WeekTask;
  recurring?: TodayRecurringItem;
}

export function weekDates(anchor: string): string[] {
  const start = DateTime.fromISO(anchor).startOf("week");
  return Array.from({ length: 7 }, (_, index) => start.plus({ days: index }).toISODate()!);
}

export function mergeWeekTimeline(_frame: DayTemplate, tasks: WeekTask[], recurring: TodayRecurringItem[] = []): WeekTimelineEntry[] {
  const taskEntries: WeekTimelineEntry[] = tasks.map((task) => ({
    id: `task-${task.id}`,
    type: task.status === "moved" ? "moved" :
      task.status === "done" && !!task.completedOn && task.completedOn < task.onDate ? "completed" :
      task.startMin === null ? "overdue" : "task",
    title: task.title,
    startMin: task.status === "done" && !!task.completedOn && task.completedOn < task.onDate ? null : task.startMin,
    durationMin: task.durationMin,
    task,
  }));
  const recurringEntries: WeekTimelineEntry[] = recurring.map((item) => ({
    id: item.id,
    type: "recurring",
    title: item.title,
    startMin: item.startMin,
    durationMin: item.durationMin,
    recurring: item,
  }));
  const typeOrder: Record<WeekTimelineEntry["type"], number> = { recurring: 0, task: 1, overdue: 2, completed: 3, moved: 4 };
  return [...taskEntries, ...recurringEntries].sort((a, b) => {
    const aStart = a.startMin ?? Number.MAX_SAFE_INTEGER;
    const bStart = b.startMin ?? Number.MAX_SAFE_INTEGER;
    return aStart - bStart || typeOrder[a.type] - typeOrder[b.type] || a.id.localeCompare(b.id);
  });
}
