import { DateTime } from "luxon";
import { proposePlacements, type DayTemplate, type PlacementCost, type PlacementProposal, type PlanBlock } from "./adaptive";

export interface PlanningDay {
  template: DayTemplate;
  /** Schoolwork cannot begin before this time on this date. */
  notBefore: number;
}

export interface SchoolworkRequest {
  id: string;
  title: string;
  kind: "assignment" | "test" | "short-test";
  totalMin: number;
  dueDate: string;
  selectedDates: string[];
}

export interface WorkSession {
  date: string;
  minutes: number;
  role: "study" | "refresher";
  placement: PlacementProposal;
}

export type SchoolworkPlan =
  | { ok: true; sessions: WorkSession[] }
  | { ok: false; reason: "invalid-days" | "test-days" | "invalid-duration" | "insufficient-time"; shortfallMin?: number };

const MAX_DAILY_SCHOOL_MIN = 120;

export function cleanWindows(day: PlanningDay): { start: number; end: number }[] {
  const end = day.template.workCutoff;
  let cursor = Math.max(day.notBefore, day.template.wake);
  const windows: { start: number; end: number }[] = [];
  for (const block of [...day.template.blocks].sort((a, b) => a.start - b.start)) {
    if (block.end <= cursor) continue;
    if (block.start > cursor) {
      const next = Math.min(block.start, end);
      if (next - cursor >= 1) windows.push({ start: cursor, end: next });
    }
    cursor = Math.max(cursor, block.end);
    if (cursor >= end) break;
  }
  if (end - cursor >= 1) windows.push({ start: cursor, end });
  return windows;
}

export interface SchoolworkTradeoff {
  id: string;
  title: string;
  sessions: WorkSession[];
  costs: PlacementCost[];
}

export interface CustomTradeoffSource {
  id: string;
  date: string;
  blockId?: string;
  title: string;
  type: PlacementCost["type"];
  originalMinutes: number;
  minimumMinutes: number;
  maxRemovable: number;
}

export interface CustomTradeoffDraft {
  requiredMinutes: number;
  sources: CustomTradeoffSource[];
}

export interface CustomAllocation { sourceId: string; minutes: number }

interface AvailableBlock { day: PlanningDay; block: PlanBlock; available: number }

function isUrgentDay(request: SchoolworkRequest, date: string): boolean {
  return DateTime.fromISO(request.dueDate).minus({ days: 1 }).toISODate() === date;
}

function canTradeBlock(request: SchoolworkRequest, day: PlanningDay, block: PlanBlock): boolean {
  if (block.policy !== "flexible" || (block.canUseFor && block.canUseFor !== "school")) return false;
  if (block.end <= day.notBefore) return false;
  return block.cost !== "winddown" || isUrgentDay(request, day.template.date);
}

function tradeableBlockMinutes(day: PlanningDay, block: PlanBlock): {
  originalMinutes: number; minimumMinutes: number; maxRemovable: number;
} {
  const passedMinutes = Math.max(0, Math.min(block.end, day.notBefore) - block.start);
  const originalMinutes = Math.max(0, block.end - Math.max(block.start, day.notBefore));
  const minimumMinutes = Math.max(0, (block.minMinutes ?? 0) - passedMinutes);
  return { originalMinutes, minimumMinutes, maxRemovable: Math.max(0, originalMinutes - minimumMinutes) };
}

function directSession(day: PlanningDay, request: SchoolworkRequest, start: number, minutes: number,
  role: WorkSession["role"], costs: PlacementCost[] = []): WorkSession {
  const end = start + minutes;
  const bedtime = Math.max(day.template.bedtime, end);
  return { date: day.template.date, minutes, role, placement: { start, end, bedtime,
    remainingSleepMin: day.template.nextWake + 1440 - bedtime, overdue: false, costs } };
}

function cleanBase(request: SchoolworkRequest, selected: PlanningDay[]): { sessions: WorkSession[]; remaining: number } {
  let remaining = request.totalMin;
  const sessions: WorkSession[] = [];
  for (const day of selected) {
    let daily = MAX_DAILY_SCHOOL_MIN;
    for (const window of cleanWindows(day)) {
      if (remaining === 0 || daily === 0) break;
      const amount = Math.min(remaining, daily, window.end - window.start);
      if (amount < 1) continue;
      sessions.push(directSession(day, request, window.start, amount, "study"));
      remaining -= amount;
      daily -= amount;
    }
  }
  return { sessions, remaining };
}

function selectedDays(request: SchoolworkRequest, days: PlanningDay[]): PlanningDay[] | null {
  const selected = request.selectedDates.map((date) => days.find((day) => day.template.date === date))
    .filter((day): day is PlanningDay => !!day).sort((a, b) => a.template.date.localeCompare(b.template.date));
  return selected.length === request.selectedDates.length && selected.length > 0 ? selected : null;
}

export function customTradeoffDraft(request: SchoolworkRequest, days: PlanningDay[]): CustomTradeoffDraft | null {
  const selected = selectedDays(request, days);
  if (!selected) return null;
  const base = cleanBase(request, selected);
  if (base.remaining === 0) return null;
  const sources: CustomTradeoffSource[] = [];
  for (const day of selected) {
    for (const block of day.template.blocks) {
      if (!canTradeBlock(request, day, block)) continue;
      const { originalMinutes, minimumMinutes, maxRemovable } = tradeableBlockMinutes(day, block);
      if (maxRemovable < 1) continue;
      sources.push({ id: `${day.template.date}:${block.id}`, date: day.template.date, blockId: block.id,
        title: block.title, type: block.cost ?? "routine", originalMinutes, minimumMinutes, maxRemovable });
    }
    const isUrgent = isUrgentDay(request, day.template.date);
    if (isUrgent) {
      const sleepStart = Math.max(day.template.bedtime, day.notBefore);
      const originalMinutes = Math.max(0, day.template.nextWake + 1440 - sleepStart);
      const minimumMinutes = 0;
      const maxRemovable = originalMinutes;
      if (maxRemovable >= 1) sources.push({ id: `${day.template.date}:sleep`, date: day.template.date,
        title: "Sleep", type: "sleep", originalMinutes, minimumMinutes, maxRemovable });
    }
  }
  return sources.reduce((sum, source) => sum + source.maxRemovable, 0) >= base.remaining ?
    { requiredMinutes: base.remaining, sources } : null;
}

export function buildCustomSchoolworkTradeoff(request: SchoolworkRequest, days: PlanningDay[],
  allocation: CustomAllocation[]): SchoolworkTradeoff | null {
  const selected = selectedDays(request, days);
  const draft = customTradeoffDraft(request, days);
  if (!selected || !draft) return null;
  const sourceById = new Map(draft.sources.map((source) => [source.id, source]));
  const seen = new Set<string>();
  let total = 0;
  for (const item of allocation) {
    const source = sourceById.get(item.sourceId);
    if (!source || seen.has(item.sourceId) || !Number.isInteger(item.minutes) || item.minutes < 0 ||
      item.minutes > source.maxRemovable) return null;
    seen.add(item.sourceId);
    total += item.minutes;
  }
  if (total !== draft.requiredMinutes) return null;

  const base = cleanBase(request, selected);
  const sessions = [...base.sessions];
  const costs: PlacementCost[] = [];
  for (const item of allocation) {
    if (item.minutes === 0) continue;
    const source = sourceById.get(item.sourceId)!;
    const day = selected.find((candidate) => candidate.template.date === source.date)!;
    if (source.type === "sleep") {
      const cost: PlacementCost = { type: "sleep", title: `Sleep · ${DateTime.fromISO(source.date).toFormat("ccc")}`,
        lostMin: item.minutes, remainingMin: source.originalMinutes - item.minutes };
      costs.push(cost);
      sessions.push(directSession(day, request, Math.max(day.template.bedtime, day.notBefore), item.minutes, "study", [cost]));
      continue;
    }
    const block = day.template.blocks.find((candidate) => candidate.id === source.blockId);
    if (!block) return null;
    const cost: PlacementCost = { blockId: block.id,
      title: `${block.title} · ${DateTime.fromISO(source.date).toFormat("ccc")}`, type: source.type,
      lostMin: item.minutes, remainingMin: source.originalMinutes - item.minutes };
    costs.push(cost);
    sessions.push(directSession(day, request, block.end - item.minutes, item.minutes, "study", [cost]));
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.placement.start - b.placement.start);
  return sessions.reduce((sum, session) => sum + session.minutes, 0) === request.totalMin ?
    { id: "custom", title: "Your custom plan", sessions, costs } : null;
}

function allocateFromBlocks(blocks: AvailableBlock[], remaining: number, balanced: boolean, perBlockCap = Infinity) {
  const used = new Map<AvailableBlock, number>();
  if (balanced) {
    while (remaining > 0) {
      let changed = false;
      for (const item of blocks) {
        const amount = used.get(item) ?? 0;
        if (amount + 1 > Math.min(item.available, perBlockCap)) continue;
        used.set(item, amount + 1);
        remaining -= 1;
        changed = true;
      }
      if (!changed) break;
    }
  } else {
    for (const item of blocks) {
      if (remaining === 0) break;
      const amount = Math.min(item.available, perBlockCap, remaining);
      if (amount >= 1) {
        used.set(item, amount);
        remaining -= amount;
      }
    }
  }
  return { used, remaining };
}

/** Explicit alternatives for work that cannot fit in clean time. Nothing is applied here. */
export function proposeSchoolworkTradeoffs(request: SchoolworkRequest, days: PlanningDay[]): SchoolworkTradeoff[] {
  const selected = selectedDays(request, days);
  if (!selected) return [];
  const base = cleanBase(request, selected);
  if (base.remaining === 0) return [];

  const flexible = selected.flatMap((day) => day.template.blocks
    .filter((block) => canTradeBlock(request, day, block))
    .map((block) => ({ day, block, available: tradeableBlockMinutes(day, block).maxRemovable }))
    .filter((item) => item.available >= 1));
  const byType = (type: PlacementCost["type"]) => flexible.filter((item) => (item.block.cost ?? "routine") === type);
  const strategies = [
    { id: "protect-evening", title: "Use school friend time and small routine cuts", order: ["friend", "routine", "winddown"] as const, balanceRoutine: true, routineCap: 10 },
    { id: "share-cuts", title: "Split cuts across routines", order: ["routine", "friend", "winddown"] as const, balanceRoutine: true, routineCap: Infinity },
    { id: "protect-routines", title: "Protect workout and goal time", order: ["friend", "winddown"] as const, balanceRoutine: false, routineCap: 0 },
  ];
  const results: SchoolworkTradeoff[] = [];
  const seen = new Set<string>();

  for (const strategy of strategies) {
    let remaining = base.remaining;
    const used = new Map<AvailableBlock, number>();
    for (const type of strategy.order) {
      const allocation = allocateFromBlocks(byType(type), remaining, type === "routine" && strategy.balanceRoutine,
        type === "routine" ? strategy.routineCap : Infinity);
      for (const [item, amount] of allocation.used) used.set(item, (used.get(item) ?? 0) + amount);
      remaining = allocation.remaining;
    }

    let sleep: { day: PlanningDay; minutes: number } | null = null;
    if (remaining > 0) {
      const urgentDay = [...selected].reverse().find((day) =>
        isUrgentDay(request, day.template.date));
      if (urgentDay) {
        const sleepStart = Math.max(urgentDay.template.bedtime, urgentDay.notBefore);
        const capacity = Math.max(0, urgentDay.template.nextWake + 1440 - sleepStart);
        const amount = Math.min(remaining, capacity);
        if (amount >= 1) { sleep = { day: urgentDay, minutes: amount }; remaining -= amount; }
      }
    }
    if (remaining > 0) continue;

    const sessions = [...base.sessions];
    const costs: PlacementCost[] = [];
    for (const [item, amount] of used) {
      const type = item.block.cost ?? "routine";
      const dayName = DateTime.fromISO(item.day.template.date).toFormat("ccc");
      const cost: PlacementCost = { blockId: item.block.id, title: `${item.block.title} · ${dayName}`, type,
        lostMin: amount, remainingMin: item.block.end - item.block.start - amount };
      costs.push(cost);
      sessions.push(directSession(item.day, request, item.block.end - amount, amount, "study", [cost]));
    }
    if (sleep) {
      const cost: PlacementCost = { type: "sleep", lostMin: sleep.minutes };
      costs.push(cost);
      sessions.push(directSession(sleep.day, request,
        Math.max(sleep.day.template.bedtime, sleep.day.notBefore), sleep.minutes, "study", [cost]));
    }
    sessions.sort((a, b) => a.date.localeCompare(b.date) || a.placement.start - b.placement.start);
    const signature = costs.map((cost) => `${cost.type}:${cost.blockId ?? ""}:${cost.lostMin}`).sort().join("|");
    if (!seen.has(signature)) {
      seen.add(signature);
      const types = new Set(costs.map((cost) => cost.type));
      const sleepCost = costs.find((cost) => cost.type === "sleep");
      const nonSleepTypes = new Set(costs.filter((cost) => cost.type !== "sleep").map((cost) => cost.type));
      const exactBase = nonSleepTypes.size === 1 && nonSleepTypes.has("winddown") ? "Use before-sleep time" :
        nonSleepTypes.size === 1 && nonSleepTypes.has("friend") ? "Use school friend time" :
        nonSleepTypes.size === 1 && nonSleepTypes.has("routine") ? "Shorten routines" : strategy.title;
      const title = sleepCost && types.size === 1 ? `Use ${sleepCost.lostMin} min of sleep` :
        sleepCost ? `${exactBase} + ${sleepCost.lostMin} min less sleep` :
        types.size === 1 && types.has("friend") ? "Use school friend time" : strategy.title;
      results.push({ id: strategy.id, title, sessions, costs });
    }
  }
  return results;
}

/** Total clean time, capped so one selected day is not overloaded. */
export function cleanCapacity(day: PlanningDay): number {
  const total = cleanWindows(day).reduce((sum, window) => sum + window.end - window.start, 0);
  return Math.min(MAX_DAILY_SCHOOL_MIN, total);
}

export function suggestWorkdays(days: PlanningDay[], dueDate: string): { date: string; availableMin: number }[] {
  return days
    .filter((day) => day.template.date < dueDate)
    .map((day) => ({ date: day.template.date, availableMin: cleanCapacity(day) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function testRefresherMinutes(totalMin: number): number {
  if (totalMin >= 30) {
    return Math.min(30, Math.max(15, Math.round(totalMin * 0.25 / 5) * 5));
  }
  return Math.min(totalMin - 1, Math.max(1, Math.round(totalMin * 0.25)));
}

/** Default suggestion, still editable: use the latest days with enough clean capacity. */
export function recommendWorkdays(days: PlanningDay[], dueDate: string, totalMin: number,
  kind: SchoolworkRequest["kind"]): string[] {
  const options = suggestWorkdays(days, dueDate).filter((day) => day.availableMin >= 1);
  if (kind === "test") {
    const dayBefore = DateTime.fromISO(dueDate).minus({ days: 1 }).toISODate();
    const refresherMin = testRefresherMinutes(totalMin);
    const refresher = options.find((day) => day.date === dayBefore && day.availableMin >= refresherMin);
    const study = [...options].reverse().find((day) => day.date < (dayBefore ?? "") && day.availableMin >= totalMin - refresherMin);
    return refresher && study ? [study.date, refresher.date] : [];
  }
  let remaining = totalMin;
  const chosen: string[] = [];
  for (const option of [...options].reverse()) {
    if (remaining <= 0) break;
    chosen.push(option.date);
    remaining -= option.availableMin;
  }
  return remaining <= 0 ? chosen.reverse() : [];
}

function place(day: PlanningDay, request: SchoolworkRequest, minutes: number, role: WorkSession["role"]): WorkSession[] | null {
  let remaining = minutes;
  const sessions: WorkSession[] = [];
  for (const window of cleanWindows(day)) {
    if (remaining === 0) break;
    const amount = Math.min(remaining, window.end - window.start);
    if (amount < 1) continue;
    const placement = proposePlacements(day.template, {
      id: request.id, title: request.title, durationMin: amount,
      kind: "school", mode: "fixed", at: window.start,
    }).find((candidate) => candidate.costs.length === 0);
    if (!placement) return null;
    sessions.push({ date: day.template.date, minutes: amount, role, placement });
    remaining -= amount;
  }
  return remaining === 0 ? sessions : null;
}

/** Preview work blocks on the chosen days without writing to a schedule. */
export function planSchoolwork(request: SchoolworkRequest, days: PlanningDay[]): SchoolworkPlan {
  if (!Number.isInteger(request.totalMin) || request.totalMin < 1) {
    return { ok: false, reason: "invalid-duration" };
  }
  const byDate = new Map(days.map((day) => [day.template.date, day]));
  if (request.selectedDates.length === 0 || new Set(request.selectedDates).size !== request.selectedDates.length ||
      request.selectedDates.some((date) => date >= request.dueDate || !byDate.has(date))) {
    return { ok: false, reason: "invalid-days" };
  }

  const dates = [...request.selectedDates].sort();
  if (request.kind === "test") {
    const dayBefore = DateTime.fromISO(request.dueDate).minus({ days: 1 }).toISODate();
    if (dates.length !== 2 || !dayBefore || dates[1] !== dayBefore || request.totalMin < 2) {
      return { ok: false, reason: "test-days" };
    }
    const refresherMin = testRefresherMinutes(request.totalMin);
    const firstMin = request.totalMin - refresherMin;
    const first = byDate.get(dates[0]!)!;
    const refresher = byDate.get(dates[1]!)!;
    const shortfallMin = Math.max(0, firstMin - cleanCapacity(first)) +
      Math.max(0, refresherMin - cleanCapacity(refresher));
    if (shortfallMin > 0) return { ok: false, reason: "insufficient-time", shortfallMin };
    const studySessions = place(first, request, firstMin, "study");
    const refresherSessions = place(refresher, request, refresherMin, "refresher");
    if (!studySessions || !refresherSessions) return { ok: false, reason: "insufficient-time", shortfallMin: request.totalMin };
    return { ok: true, sessions: [...studySessions, ...refresherSessions] };
  }

  const selected = dates.map((date) => byDate.get(date)!);
  const capacities = selected.map(cleanCapacity);
  const totalCapacity = capacities.reduce((sum, capacity) => sum + capacity, 0);
  if (totalCapacity < request.totalMin) {
    return { ok: false, reason: "insufficient-time", shortfallMin: request.totalMin - totalCapacity };
  }

  const base = Math.floor(request.totalMin / selected.length);
  const allocations = capacities.map((capacity) => Math.min(capacity, base));
  let remaining = request.totalMin - allocations.reduce((sum, minutes) => sum + minutes, 0);
  while (remaining > 0) {
    let changed = false;
    for (let i = 0; i < allocations.length && remaining > 0; i++) {
      if (allocations[i]! + 1 > capacities[i]!) continue;
      allocations[i] = allocations[i]! + 1;
      remaining -= 1;
      changed = true;
    }
    if (!changed) return { ok: false, reason: "insufficient-time", shortfallMin: remaining };
  }

  const sessions: WorkSession[] = [];
  for (let i = 0; i < selected.length; i++) {
    const minutes = allocations[i]!;
    if (minutes === 0) continue;
    const placed = place(selected[i]!, request, minutes, "study");
    if (!placed) return { ok: false, reason: "insufficient-time", shortfallMin: minutes };
    sessions.push(...placed);
  }
  return { ok: true, sessions };
}
