import { recurringCommitmentsFor, type RecurringKind } from "./recurring-commitments";

export interface TodayTask {
  id: number;
  title: string;
  onDate: string;
  durationMin: number;
  startMin: number | null;
  kind: string;
  status: string;
  dueDate: string | null;
  movedToDate: string | null;
  completedOn?: string | null;
}

export interface RoutineMark {
  slotKey: string;
  status: string;
}

export interface TodayRecurringItem {
  id: string;
  slotKey: string;
  title: string;
  onDate: string;
  durationMin: number;
  startMin: number;
  kind: RecurringKind;
  status: "planned" | "done";
}

export type TodayTimelineEntry =
  | (Omit<TodayTask, "id"> & { id: string; taskId: number; source: "task" })
  | (TodayRecurringItem & { source: "recurring" });

export function recurringItemsForToday(date: string, marks: RoutineMark[]): TodayRecurringItem[] {
  const done = new Set(marks.filter((mark) => mark.status === "done").map((mark) => mark.slotKey));
  return recurringCommitmentsFor(date).map((item) => ({
    id: `recurring:${date}:${item.slotKey}`,
    slotKey: item.slotKey,
    title: item.title,
    onDate: date,
    durationMin: item.end - item.start,
    startMin: item.start,
    kind: item.kind,
    status: done.has(item.slotKey) ? "done" : "planned",
  }));
}

export function mergeTodayTimeline(tasks: TodayTask[], recurring: TodayRecurringItem[]): TodayTimelineEntry[] {
  const saved: TodayTimelineEntry[] = tasks
    .filter((task) => task.status !== "moved" && task.status !== "cancelled" && task.startMin !== null &&
      !(task.status === "done" && !!task.completedOn && task.completedOn < task.onDate))
    .map((task) => ({ ...task, id: `task:${task.id}`, taskId: task.id, source: "task" as const }));
  const computed: TodayTimelineEntry[] = recurring.map((item) => ({ ...item, source: "recurring" as const }));
  return [...saved, ...computed].sort((a, b) =>
    a.startMin! - b.startMin! || a.id.localeCompare(b.id));
}
