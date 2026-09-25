export interface RebalanceCost {
  type: string;
  lostMin: number;
  title?: string;
}

export interface RebalanceTask {
  id: number;
  title: string;
  startMin: number | null;
  durationMin: number;
  status: string;
  approvedCosts: RebalanceCost[] | null;
}

export interface RebalanceUpdate {
  id: number;
  startMin: number;
  durationMin: number;
  approvedCosts: RebalanceCost[];
}

export interface RebalanceSplit {
  sourceId: number;
  startMin: number;
  durationMin: number;
  approvedCosts: RebalanceCost[];
}

export interface RebalanceResult {
  updates: RebalanceUpdate[];
  splits: RebalanceSplit[];
}

const PRIORITY: Record<string, number> = { friend: 1, routine: 2, winddown: 3, sleep: 4 };

function rank(type: string): number {
  return PRIORITY[type] ?? 1;
}

function positiveCosts(costs: RebalanceCost[] | null): RebalanceCost[] {
  return (costs ?? []).filter((cost) => Number.isFinite(cost.lostMin) && cost.lostMin > 0)
    .map((cost) => ({ ...cost }));
}

function severity(costs: RebalanceCost[]): number {
  return costs.reduce((highest, cost) => Math.max(highest, rank(cost.type)), 0);
}

function removeHighestCost(costs: RebalanceCost[], minutes: number): RebalanceCost[] {
  let remaining = minutes;
  const ordered = costs.map((cost, index) => ({ cost: { ...cost }, index }))
    .sort((a, b) => rank(b.cost.type) - rank(a.cost.type) || a.index - b.index);
  for (const item of ordered) {
    if (remaining <= 0) break;
    const removed = Math.min(item.cost.lostMin, remaining);
    item.cost.lostMin -= removed;
    remaining -= removed;
  }
  return ordered.sort((a, b) => a.index - b.index).map((item) => item.cost)
    .filter((cost) => cost.lostMin > 0);
}

interface DestinationSegment {
  start: number;
  duration: number;
  cost: RebalanceCost | null;
}

function destinationSegments(completed: RebalanceTask): DestinationSegment[] {
  if (completed.startMin === null || completed.durationMin <= 0) return [];
  const costs = positiveCosts(completed.approvedCosts)
    .sort((a, b) => rank(a.type) - rank(b.type));
  const costMinutes = Math.min(completed.durationMin, costs.reduce((sum, cost) => sum + cost.lostMin, 0));
  const segments: DestinationSegment[] = [];
  let cursor = completed.startMin;
  const cleanMinutes = completed.durationMin - costMinutes;
  if (cleanMinutes > 0) {
    segments.push({ start: cursor, duration: cleanMinutes, cost: null });
    cursor += cleanMinutes;
  }
  let remaining = completed.durationMin - cleanMinutes;
  for (const cost of costs) {
    if (remaining <= 0) break;
    const duration = Math.min(cost.lostMin, remaining);
    segments.push({ start: cursor, duration, cost: { ...cost, lostMin: duration } });
    cursor += duration;
    remaining -= duration;
  }
  return segments;
}

/**
 * Reuse a future slot only to restore a more important sacrificed resource.
 * The function is pure; callers apply the returned updates and inserts atomically.
 */
export function rebalanceFreedSlot(completed: RebalanceTask, tasks: RebalanceTask[]): RebalanceResult {
  const updates: RebalanceUpdate[] = [];
  const splits: RebalanceSplit[] = [];
  const candidates = tasks
    .filter((task) => task.id !== completed.id && task.status === "planned" && task.startMin !== null)
    .map((task) => ({ task, costs: positiveCosts(task.approvedCosts) }))
    .filter((item) => item.costs.length > 0)
    .sort((a, b) => severity(b.costs) - severity(a.costs) || a.task.startMin! - b.task.startMin! || a.task.id - b.task.id);

  for (const segment of destinationSegments(completed)) {
    let cursor = segment.start;
    let available = segment.duration;
    const destinationRank = segment.cost ? rank(segment.cost.type) : 0;
    while (available > 0) {
      const index = candidates.findIndex((item) => severity(item.costs) > destinationRank);
      if (index < 0) break;
      const candidate = candidates.splice(index, 1)[0]!;
      const sacrificed = candidate.costs.filter((cost) => rank(cost.type) > destinationRank)
        .reduce((sum, cost) => sum + cost.lostMin, 0);
      const movedMinutes = Math.min(available, candidate.task.durationMin, sacrificed);
      if (movedMinutes <= 0) continue;
      const destinationCosts = segment.cost ? [{ ...segment.cost, lostMin: movedMinutes }] : [];

      if (movedMinutes === candidate.task.durationMin) {
        updates.push({ id: candidate.task.id, startMin: cursor, durationMin: candidate.task.durationMin,
          approvedCosts: destinationCosts });
      } else {
        updates.push({ id: candidate.task.id, startMin: candidate.task.startMin! + movedMinutes,
          durationMin: candidate.task.durationMin - movedMinutes,
          approvedCosts: removeHighestCost(candidate.costs, movedMinutes) });
        splits.push({ sourceId: candidate.task.id, startMin: cursor, durationMin: movedMinutes,
          approvedCosts: destinationCosts });
      }
      cursor += movedMinutes;
      available -= movedMinutes;
    }
  }
  return { updates, splits };
}

/** Deletion frees time only when unfinished work still occupied an exact slot. */
export function rebalanceAfterDeletion(removed: RebalanceTask, tasks: RebalanceTask[], notBefore = 0): RebalanceResult {
  if (removed.status !== "planned" || removed.startMin === null || removed.startMin < notBefore) {
    return { updates: [], splits: [] };
  }
  return rebalanceFreedSlot(removed, tasks);
}
