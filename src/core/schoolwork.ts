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

const MAX_SESSION_MIN = 120;

/** Longest uninterrupted clean session; friend time and other flexible time remain untouched. */
export function cleanCapacity(day: PlanningDay): number {
  const end = day.template.bedtime;
  let cursor = Math.max(day.notBefore, day.template.wake);
  let longest = 0;
  const occupied = [...day.template.blocks].sort((a, b) => a.start - b.start);
  for (const block of occupied) {
    if (block.end <= cursor) continue;
    if (block.start > cursor) longest = Math.max(longest, Math.min(block.start, end) - cursor);
    cursor = Math.max(cursor, block.end);
    if (cursor >= end) break;
  }
  longest = Math.max(longest, end - cursor);
  return Math.max(0, Math.min(MAX_SESSION_MIN, longest));
}

export function suggestWorkdays(days: PlanningDay[], dueDate: string): { date: string; availableMin: number }[] {
  return days
    .filter((day) => day.template.date < dueDate)
    .map((day) => ({ date: day.template.date, availableMin: cleanCapacity(day) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function place(day: PlanningDay, request: SchoolworkRequest, minutes: number, role: WorkSession["role"]): WorkSession | null {
  const placement = proposePlacements(day.template, {
    id: request.id,
    title: request.title,
    durationMin: minutes,
    kind: "school",
    mode: "auto",
    notBefore: day.notBefore,
  }).find((candidate) => candidate.costs.length === 0);
  if (!placement) return null;
  return { date: day.template.date, minutes, role, placement };
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
    const studySession = place(first, request, firstMin, "study");
    const refresherSession = place(refresher, request, refresherMin, "refresher");
    if (!studySession || !refresherSession) return { ok: false, reason: "insufficient-time", shortfallMin: request.totalMin };
    return { ok: true, sessions: [studySession, refresherSession] };
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
    const session = place(selected[i]!, request, minutes, "study");
    if (!session) return { ok: false, reason: "insufficient-time", shortfallMin: minutes };
    sessions.push(session);
  }
  return { ok: true, sessions };
}
