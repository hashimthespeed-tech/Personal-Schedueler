import { proposePlacements, type DayTemplate, type PlacementCost, type PlacementRequest } from "./adaptive";

export interface ExistingTask {
  id: string;
  title: string;
  start: number | null;
  end: number | null;
  status: "planned" | "done" | "moved" | "cancelled";
}

export type QuickAddRequest = Pick<PlacementRequest, "title" | "durationMin" | "kind" | "mode" | "at" | "urgentDueTomorrow">;

export interface TaskOption {
  start: number | null;
  end: number | null;
  overdue: boolean;
  costs: PlacementCost[];
  remainingSleepMin: number;
}

/** Read-only options for the approval step; a past item belongs in the overdue tray. */
export function previewTask(day: DayTemplate, request: QuickAddRequest, existing: ExistingTask[], notBefore: number): TaskOption[] {
  if (request.mode === "past") {
    return [{ start: null, end: null, overdue: true, costs: [],
      remainingSleepMin: day.nextWake + 1440 - day.bedtime }];
  }
  if (request.mode === "fixed" && (request.at === undefined || request.at < notBefore)) return [];

  const blocks = existing
    .filter((task) => (task.status === "planned" || task.status === "done") && task.start !== null && task.end !== null)
    .map((task) => ({ id: `task-${task.id}`, title: task.title, start: task.start!, end: task.end!, policy: "fixed" as const }));
  const proposals = proposePlacements({ ...day, blocks: [...day.blocks, ...blocks] }, {
    id: "preview", title: request.title, durationMin: request.durationMin, kind: request.kind,
    mode: request.mode, ...(request.at === undefined ? {} : { at: request.at }),
    notBefore, urgentDueTomorrow: request.urgentDueTomorrow,
  });
  return proposals.map((proposal) => ({
    start: proposal.start, end: proposal.end, overdue: proposal.overdue,
    costs: proposal.costs, remainingSleepMin: proposal.remainingSleepMin,
  }));
}
