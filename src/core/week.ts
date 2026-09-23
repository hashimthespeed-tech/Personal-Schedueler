import { DateTime } from "luxon";
import type { DayTemplate } from "./adaptive";

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
}

export interface WeekTimelineEntry {
  id: string;
  type: "protected" | "task" | "overdue" | "moved";
  title: string;
  startMin: number | null;
  durationMin: number;
  task?: WeekTask;
  protected?: boolean;
}

export function weekDates(anchor: string): string[] {
  const start = DateTime.fromISO(anchor).startOf("week");
  return Array.from({ length: 7 }, (_, index) => start.plus({ days: index }).toISODate()!);
}

export function mergeWeekTimeline(frame: DayTemplate, tasks: WeekTask[]): WeekTimelineEntry[] {
  const schoolPattern = /^\d+-(?:commute-am|p\d+|gap-\d+|practice|commute-pm)$/;
  const schoolBlocks = frame.blocks.filter((block) => schoolPattern.test(block.id));
  const displayBlocks = frame.blocks.filter((block) => !schoolPattern.test(block.id));
  const blocks: WeekTimelineEntry[] = displayBlocks.map((block) => ({
    id: `block-${block.id}`,
    type: "protected",
    title: block.title,
    startMin: block.start,
    durationMin: block.end - block.start,
    protected: block.policy !== "flexible",
  }));
  if (schoolBlocks.length > 0) {
    const start = Math.min(...schoolBlocks.map((block) => block.start));
    const end = Math.max(...schoolBlocks.map((block) => block.end));
    blocks.push({ id: "block-school-day", type: "protected",
      title: schoolBlocks.some((block) => block.id.endsWith("-practice")) ? "School + wrestling practice" : "School",
      startMin: start, durationMin: end - start, protected: true });
  }
  const taskEntries: WeekTimelineEntry[] = tasks.map((task) => ({
    id: `task-${task.id}`,
    type: task.status === "moved" ? "moved" : task.startMin === null ? "overdue" : "task",
    title: task.title,
    startMin: task.startMin,
    durationMin: task.durationMin,
    task,
  }));
  const typeOrder: Record<WeekTimelineEntry["type"], number> = { protected: 0, task: 1, overdue: 2, moved: 3 };
  return [...blocks, ...taskEntries].sort((a, b) => {
    const aStart = a.startMin ?? Number.MAX_SAFE_INTEGER;
    const bStart = b.startMin ?? Number.MAX_SAFE_INTEGER;
    return aStart - bStart || typeOrder[a.type] - typeOrder[b.type] || a.id.localeCompare(b.id);
  });
}
