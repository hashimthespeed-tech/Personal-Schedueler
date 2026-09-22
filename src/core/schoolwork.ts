import { DateTime } from "luxon";
import { proposePlacements, type DayTemplate, type PlacementProposal } from "./adaptive";

export interface PlanningDay {
  template: DayTemplate;
  /** Schoolwork cannot begin before this time on this date. */
  notBefore: number;
}

export interface SchoolworkRequest {
  id: string;
  title: string;
  kind: "assignment" | "test";
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

function cleanWindows(day: PlanningDay): { start: number; end: number }[] {
  const end = day.template.bedtime;
  let cursor = Math.max(day.notBefore, day.template.wake);
  const windows: { start: number; end: number }[] = [];
  for (const block of [...day.template.blocks].sort((a, b) => a.start - b.start)) {
    if (block.end <= cursor) continue;
    if (block.start > cursor) {
      const next = Math.min(block.start, end);
      if (next - cursor >= 5) windows.push({ start: cursor, end: next });
    }
    cursor = Math.max(cursor, block.end);
    if (cursor >= end) break;
  }
  if (end - cursor >= 5) windows.push({ start: cursor, end });
  return windows;
}

/** Total clean time, capped so one selected day is not overloaded. */
export function cleanCapacity(day: PlanningDay): number {
  const total = cleanWindows(day).reduce((sum, window) => sum + window.end - window.start, 0);
  return Math.min(MAX_DAILY_SCHOOL_MIN, Math.floor(total / 5) * 5);
}

export function suggestWorkdays(days: PlanningDay[], dueDate: string): { date: string; availableMin: number }[] {
  return days
    .filter((day) => day.template.date < dueDate)
    .map((day) => ({ date: day.template.date, availableMin: cleanCapacity(day) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Default suggestion, still editable: use the latest days with enough clean capacity. */
export function recommendWorkdays(days: PlanningDay[], dueDate: string, totalMin: number,
  kind: SchoolworkRequest["kind"]): string[] {
  const options = suggestWorkdays(days, dueDate).filter((day) => day.availableMin >= 15);
  if (kind === "test") {
    const dayBefore = DateTime.fromISO(dueDate).minus({ days: 1 }).toISODate();
    const refresherMin = Math.min(30, Math.max(15, Math.round(totalMin * 0.25 / 5) * 5));
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
    const amount = Math.min(remaining, Math.floor((window.end - window.start) / 5) * 5);
    if (amount < 5) continue;
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
  if (!Number.isInteger(request.totalMin) || request.totalMin < 15 || request.totalMin % 5 !== 0) {
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
    if (dates.length !== 2 || !dayBefore || dates[1] !== dayBefore || request.totalMin < 30) {
      return { ok: false, reason: "test-days" };
    }
    const refresherMin = Math.min(30, Math.max(15, Math.round(request.totalMin * 0.25 / 5) * 5));
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

  const base = Math.floor(request.totalMin / selected.length / 5) * 5;
  const allocations = capacities.map((capacity) => Math.min(capacity, base));
  let remaining = request.totalMin - allocations.reduce((sum, minutes) => sum + minutes, 0);
  while (remaining > 0) {
    let changed = false;
    for (let i = 0; i < allocations.length && remaining > 0; i++) {
      if (allocations[i]! + 5 > capacities[i]!) continue;
      allocations[i] = allocations[i]! + 5;
      remaining -= 5;
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
