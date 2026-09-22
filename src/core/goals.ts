import { DateTime } from "luxon";

export type GoalCategory = "school" | "religion" | "fitness" | "ai" | "money";
export type Comparison = "at-least" | "at-most" | "range";

interface BaseGoal {
  id: number;
  category: GoalCategory;
  title: string;
  unit: string;
  target: number;
  comparison: Comparison;
  /** Upper bound when comparison is "range". */
  targetMax?: number;
  createdOn: string;
  completedOn?: string;
}

export type Goal = BaseGoal & (
  | { kind: "finite"; measure: "sum" | "latest"; startValue?: number }
  | { kind: "ongoing"; measure: "daily-number" | "daily-check"; allowedMisses: number }
);

export interface GoalEntry {
  goalId: number;
  onDate: string;
  value: number;
}

function metTarget(goal: Goal, value: number): boolean {
  if (goal.comparison === "at-least") return value >= goal.target;
  if (goal.comparison === "at-most") return value <= goal.target;
  return value >= goal.target && value <= (goal.targetMax ?? goal.target);
}

export interface MonthlyProgress {
  metDays: number;
  missedDays: number;
  unloggedDays: number;
  livesRemaining: number;
  completed: false;
  points: { date: string; value: number; met: boolean }[];
}

/** A blank day is unknown, not a secretly consumed life. */
export function assessMonthlyGoal(goal: Goal, entries: GoalEntry[], asOf: string): MonthlyProgress {
  if (goal.kind !== "ongoing") throw new Error("Monthly progress requires an ongoing goal.");
  const current = DateTime.fromISO(asOf);
  if (!current.isValid) throw new Error("Invalid progress date.");
  const monthStart = current.startOf("month");
  const firstDay = DateTime.max(monthStart, DateTime.fromISO(goal.createdOn));
  const byDate = new Map<string, GoalEntry>();
  for (const entry of entries) {
    if (entry.goalId !== goal.id || entry.onDate < firstDay.toISODate()! || entry.onDate > asOf) continue;
    byDate.set(entry.onDate, entry);
  }
  const points = [...byDate.values()]
    .sort((a, b) => a.onDate.localeCompare(b.onDate))
    .map((entry) => ({ date: entry.onDate, value: entry.value, met: metTarget(goal, entry.value) }));
  const metDays = points.filter((point) => point.met).length;
  const missedDays = points.length - metDays;
  const elapsedDays = firstDay > current ? 0 : Math.floor(current.diff(firstDay, "days").days) + 1;
  return {
    metDays,
    missedDays,
    unloggedDays: Math.max(0, elapsedDays - points.length),
    livesRemaining: Math.max(0, goal.allowedMisses - missedDays),
    completed: false,
    points,
  };
}

export interface FiniteProgress {
  value: number;
  progress: number;
  reached: boolean;
  points: { date: string; value: number }[];
}

export function assessFiniteGoal(goal: Goal, entries: GoalEntry[]): FiniteProgress {
  if (goal.kind !== "finite") throw new Error("Finite progress requires a finite goal.");
  const applicable = entries
    .filter((entry) => entry.goalId === goal.id && entry.onDate >= goal.createdOn)
    .sort((a, b) => a.onDate.localeCompare(b.onDate));
  let accumulated = 0;
  const points = applicable.map((entry) => {
    accumulated = goal.measure === "sum" ? accumulated + entry.value : entry.value;
    return { date: entry.onDate, value: accumulated };
  });
  const value = points.at(-1)?.value ?? goal.startValue ?? 0;
  const start = goal.measure === "latest" ? goal.startValue ?? 0 : 0;
  const span = goal.target - start;
  const progress = span === 0 ? (metTarget(goal, value) ? 1 : 0) :
    Math.max(0, Math.min(1, (value - start) / span));
  return { value, progress, reached: metTarget(goal, value), points };
}

/** Archive a finished numeric goal while retaining the exact entries behind its graph. */
export function finishGoal(goal: Goal, entries: GoalEntry[], completedOn: string): { goal: Goal; entries: GoalEntry[] } {
  if (goal.kind !== "finite" || !assessFiniteGoal(goal, entries).reached) {
    throw new Error("Only a reached finite goal can be finished.");
  }
  return { goal: { ...goal, completedOn }, entries: entries.filter((entry) => entry.goalId === goal.id) };
}
