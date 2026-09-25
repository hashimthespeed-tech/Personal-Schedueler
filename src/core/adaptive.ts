/** Pure placement proposals. A proposal never changes the saved day. */

export type WorkKind = "school" | "personal";
export type CostType = "friend" | "routine" | "winddown" | "sleep";

export interface PlanBlock {
  id: string;
  title: string;
  start: number;
  end: number;
  policy: "fixed" | "protected" | "flexible";
  /** Minimum duration left after a proposal uses part of a flexible block. */
  minMinutes?: number;
  cost?: Exclude<CostType, "sleep">;
  canUseFor?: WorkKind;
}

export interface DayTemplate {
  date: string;
  wake: number;
  /** Normal tasks must finish by this time. */
  workCutoff: number;
  bedtime: number;
  /** Absolute end for approved next-day urgent schoolwork. */
  emergencyEnd: number;
  nextWake: number;
  blocks: PlanBlock[];
}

export interface PlacementRequest {
  id: string;
  title: string;
  durationMin: number;
  kind: WorkKind;
  mode: "auto" | "fixed" | "past";
  at?: number;
  notBefore?: number;
  urgentDueTomorrow?: boolean;
}

export interface PlacementCost {
  blockId?: string;
  title?: string;
  type: CostType;
  lostMin: number;
  remainingMin?: number;
}

export interface PlacementProposal {
  start: number;
  end: number;
  bedtime: number;
  remainingSleepMin: number;
  overdue: boolean;
  costs: PlacementCost[];
}

const MIN_SLEEP = 7 * 60;
const STEP = 5;
const COST_WEIGHT: Record<CostType, number> = {
  friend: 2,
  routine: 4,
  winddown: 6,
  sleep: 10,
};

function overlap(start: number, end: number, block: PlanBlock): number {
  return Math.max(0, Math.min(end, block.end) - Math.max(start, block.start));
}

function evaluate(day: DayTemplate, request: PlacementRequest, start: number): PlacementProposal | null {
  const end = start + request.durationMin;
  const urgent = request.kind === "school" && request.urgentDueTomorrow === true;
  const sleepEnd = day.nextWake + 1440;
  const latestEnd = urgent ? Math.min(day.emergencyEnd, sleepEnd - MIN_SLEEP) : day.workCutoff;
  if (start < day.wake || end > latestEnd) return null;

  const costs: PlacementCost[] = [];
  for (const block of day.blocks) {
    const lostMin = overlap(start, end, block);
    if (lostMin === 0) continue;
    if (block.policy !== "flexible") return null;
    if (block.canUseFor && block.canUseFor !== request.kind) return null;
    const remainingMin = block.end - block.start - lostMin;
    if (remainingMin < (block.minMinutes ?? 0)) return null;
    costs.push({
      blockId: block.id,
      title: block.title,
      type: block.cost ?? "routine",
      lostMin,
      remainingMin,
    });
  }

  const newBedtime = Math.max(day.bedtime, end);
  if (newBedtime > day.bedtime) {
    costs.push({ type: "sleep", lostMin: newBedtime - day.bedtime });
  }

  return {
    start,
    end,
    bedtime: newBedtime,
    remainingSleepMin: sleepEnd - newBedtime,
    overdue: request.mode === "past",
    costs,
  };
}

function proposalScore(proposal: PlacementProposal): number {
  return proposal.costs.reduce((score, cost) => score + cost.lostMin * COST_WEIGHT[cost.type], 0);
}

/**
 * Return up to three distinct options, ordered by least disruption and then
 * earliest time. A fixed-time request has only its chosen start or no option.
 */
export function proposePlacements(day: DayTemplate, request: PlacementRequest): PlacementProposal[] {
  if (!Number.isInteger(request.durationMin) || request.durationMin <= 0) {
    throw new Error("Duration must be a positive whole number of minutes.");
  }
  if (request.mode === "fixed") {
    if (request.at === undefined) throw new Error("A fixed item needs a start time.");
    const proposal = evaluate(day, request, request.at);
    return proposal ? [proposal] : [];
  }

  const urgent = request.kind === "school" && request.urgentDueTomorrow === true;
  const latestEnd = urgent ? Math.min(day.emergencyEnd, day.nextWake + 1440 - MIN_SLEEP) : day.workCutoff;
  const first = Math.ceil(Math.max(day.wake, request.notBefore ?? day.wake) / STEP) * STEP;
  const candidates: PlacementProposal[] = [];
  for (let start = first; start + request.durationMin <= latestEnd; start += STEP) {
    const proposal = evaluate(day, request, start);
    if (proposal) candidates.push(proposal);
  }

  candidates.sort((a, b) => proposalScore(a) - proposalScore(b) || a.start - b.start);
  const distinct: PlacementProposal[] = [];
  const seen = new Set<string>();
  for (const proposal of candidates) {
    const signature = proposal.costs.map((cost) => `${cost.type}:${cost.blockId ?? ""}`).join("|");
    if (seen.has(signature)) continue;
    seen.add(signature);
    distinct.push(proposal);
    if (distinct.length === 3) break;
  }
  return distinct;
}
