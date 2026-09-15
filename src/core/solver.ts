/**
 * Stage A — the deterministic scheduler.
 *
 * Pure TypeScript. No LLM anywhere in this file, and that is the point:
 * packing time against hard constraints is arithmetic, and a language model
 * asked to emit a schedule directly will produce overlapping blocks and
 * silently drop constraints. Judgment happens in Stage B, over this output.
 *
 * The most valuable thing returned is not `blocks` — it is `unplaced`, with a
 * reason per item. That is what surfaces an overcommitted week on Sunday
 * rather than on Thursday when it is already too late.
 */

import type {
  Block,
  Domain,
  IsoDate,
  MinuteOfDay,
  Slot,
  SolverResult,
  Task,
  TimeRange,
  Unplaced,
  UnplacedReason,
} from "./types.js";
import { to12h } from "./types.js";
import { energySatisfies } from "./energy.js";
import { datesBetween } from "./slots.js";

/**
 * How much of available free time the solver is willing to fill.
 *
 * A schedule that consumes every waking minute is one nobody follows. This
 * leaves real slack for the parts of a life that are not tasks.
 */
export const DEFAULT_MAX_UTILIZATION = 0.7;

/** Domains that can be worked on at school during the free period. */
const OFFSITE_DOMAINS: ReadonlySet<Domain> = new Set<Domain>(["school", "ai"]);

export interface SolverInput {
  startDate: IsoDate;
  horizonDays: number;
  tasks: Task[];
  slots: Slot[];
  /** movement tags the athlete must not perform, e.g. ankle restrictions */
  restrictions?: string[];
  maxUtilization?: number;
  /** last time each spacing group was satisfied, as an absolute minute */
  spacingHistory?: Record<string, number>;
}

interface MutableSlot {
  slot: Slot;
  dayIndex: number;
  free: TimeRange[];
}

function absoluteMinute(dayIndex: number, minute: MinuteOfDay): number {
  return dayIndex * 1440 + minute;
}

function intersect(a: TimeRange, b: TimeRange): TimeRange | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

/** The time-of-day window a task is allowed to occupy. */
function taskWindow(task: Task): TimeRange {
  return {
    start: task.earliestTime ?? 0,
    end: task.latestTime ?? 1440,
  };
}

function canDoOffSite(task: Task): boolean {
  return OFFSITE_DOMAINS.has(task.domain);
}

/** Every reason a task might be barred from a slot, ignoring capacity. */
function slotEligibility(
  task: Task,
  ms: MutableSlot,
  relaxEnergy: boolean,
): { ok: true } | { ok: false; reason: UnplacedReason } {
  const { slot } = ms;

  if (task.allowedWeekdays && !task.allowedWeekdays.includes(slot.weekday)) {
    return { ok: false, reason: "no_slot_on_allowed_weekday" };
  }
  if (task.deadline && slot.date > task.deadline) {
    return { ok: false, reason: "no_slot_before_deadline" };
  }
  if (slot.offSite && !canDoOffSite(task)) {
    return { ok: false, reason: "no_slot_in_time_window" };
  }
  if (!relaxEnergy && !energySatisfies(slot.energy, task.energy)) {
    return { ok: false, reason: "no_slot_in_time_window" };
  }
  if (!intersect({ start: slot.start, end: slot.end }, taskWindow(task))) {
    return { ok: false, reason: "no_slot_in_time_window" };
  }
  return { ok: true };
}

/** Usable sub-ranges of a slot for this task, clipped to its time window. */
function usableRanges(task: Task, ms: MutableSlot): TimeRange[] {
  const window = taskWindow(task);
  const out: TimeRange[] = [];
  for (const r of ms.free) {
    const hit = intersect(r, window);
    if (hit) out.push(hit);
  }
  return out;
}

function consume(ms: MutableSlot, taken: TimeRange): void {
  const next: TimeRange[] = [];
  for (const r of ms.free) {
    if (taken.end <= r.start || taken.start >= r.end) {
      next.push(r);
      continue;
    }
    if (taken.start > r.start) next.push({ start: r.start, end: taken.start });
    if (taken.end < r.end) next.push({ start: taken.end, end: r.end });
  }
  ms.free = next;
}

const REASON_TEXT: Record<UnplacedReason, string> = {
  no_slot_long_enough: "no free stretch long enough",
  no_slot_before_deadline: "no free time left before the deadline",
  no_slot_in_time_window: "no free time inside its allowed window",
  no_slot_on_allowed_weekday: "no free time on the days it is allowed",
  spacing_conflict: "too close to the previous session",
  movement_restricted: "uses a movement currently restricted",
  horizon_full: "the week is full",
};

function describe(task: Task, reason: UnplacedReason, extra?: string): Unplaced {
  const base = REASON_TEXT[reason];
  const window =
    task.earliestTime !== undefined || task.latestTime !== undefined
      ? ` (window ${to12h(task.earliestTime ?? 0)}-${to12h(task.latestTime ?? 1440)})`
      : "";
  return {
    taskId: task.id,
    title: task.title,
    domain: task.domain,
    reason,
    detail: extra ?? `${task.durationMin}min: ${base}${window}`,
  };
}

/**
 * Order tasks for placement: deadline urgency, then priority, then how few
 * slots could hold them.
 *
 * The third key is what makes a greedy pass work. A task that fits almost
 * nowhere must go down before a flexible one eats its only opening.
 */
function orderTasks(tasks: Task[], slots: MutableSlot[]): Task[] {
  const eligibleCount = new Map<string, number>();
  for (const t of tasks) {
    let n = 0;
    for (const ms of slots) {
      if (slotEligibility(t, ms, false).ok) n++;
    }
    eligibleCount.set(t.id, n);
  }

  return [...tasks].sort((a, b) => {
    const da = a.deadline ?? "9999-12-31";
    const db = b.deadline ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    if (a.priority !== b.priority) return a.priority - b.priority;
    const ca = eligibleCount.get(a.id) ?? 0;
    const cb = eligibleCount.get(b.id) ?? 0;
    if (ca !== cb) return ca - cb;
    return b.durationMin - a.durationMin;
  });
}

export function solve(input: SolverInput): SolverResult {
  const maxUtilization = input.maxUtilization ?? DEFAULT_MAX_UTILIZATION;
  const restrictions = new Set(input.restrictions ?? []);
  const dates = datesBetween(input.startDate, input.horizonDays);
  const dayIndexOf = new Map(dates.map((d, i) => [d, i]));

  const mutable: MutableSlot[] = input.slots
    .filter((s) => dayIndexOf.has(s.date))
    .map((s) => ({
      slot: s,
      dayIndex: dayIndexOf.get(s.date) ?? 0,
      free: [{ start: s.start, end: s.end }],
    }))
    .sort((a, b) => a.dayIndex - b.dayIndex || a.slot.start - b.slot.start);

  const freeMinutes = mutable.reduce((sum, m) => sum + (m.slot.end - m.slot.start), 0);
  const budget = Math.floor(freeMinutes * maxUtilization);

  const blocks: Block[] = [];
  const unplaced: Unplaced[] = [];
  const spacing: Record<string, number> = { ...(input.spacingHistory ?? {}) };
  let scheduledMinutes = 0;

  // restricted movements never reach the solver proper
  const admissible: Task[] = [];
  for (const task of input.tasks) {
    const bad = (task.movementTags ?? []).filter((m) => restrictions.has(m));
    if (bad.length > 0) {
      unplaced.push(
        describe(task, "movement_restricted", `blocked by restriction: ${bad.join(", ")}`),
      );
      continue;
    }
    admissible.push(task);
  }

  for (const task of orderTasks(admissible, mutable)) {
    if (scheduledMinutes >= budget) {
      unplaced.push(
        describe(
          task,
          "horizon_full",
          `${task.durationMin}min: week is at capacity (${Math.round((scheduledMinutes / freeMinutes) * 100)}% of free time already scheduled)`,
        ),
      );
      continue;
    }

    const placed = placeTask(task, mutable, spacing, blocks);
    if (placed.ok) {
      scheduledMinutes += task.durationMin;
    } else {
      unplaced.push(describe(task, placed.reason));
    }
  }

  return {
    blocks: blocks.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.start - b.start)),
    unplaced,
    utilization: freeMinutes === 0 ? 0 : scheduledMinutes / freeMinutes,
    freeMinutes,
    scheduledMinutes,
  };
}

function placeTask(
  task: Task,
  slots: MutableSlot[],
  spacing: Record<string, number>,
  out: Block[],
): { ok: true } | { ok: false; reason: UnplacedReason } {
  const splittable = task.minChunkMin != null && task.minChunkMin < task.durationMin;
  const minChunk = splittable ? (task.minChunkMin ?? task.durationMin) : task.durationMin;

  // strict energy match first, then allow a downgrade rather than dropping it
  for (const relaxEnergy of [false, true]) {
    const attempt = tryPlace(task, slots, spacing, minChunk, splittable, relaxEnergy);
    if (attempt.ok) {
      out.push(...attempt.blocks);
      if (task.spacing) {
        const last = attempt.blocks[attempt.blocks.length - 1];
        if (last) {
          const ms = slots.find((m) => m.slot.date === last.date);
          spacing[task.spacing.groupKey] = absoluteMinute(ms?.dayIndex ?? 0, last.start);
        }
      }
      return { ok: true };
    }
    if (attempt.reason !== "no_slot_in_time_window") return { ok: false, reason: attempt.reason };
  }

  return { ok: false, reason: "no_slot_long_enough" };
}

function tryPlace(
  task: Task,
  slots: MutableSlot[],
  spacing: Record<string, number>,
  minChunk: number,
  splittable: boolean,
  relaxEnergy: boolean,
):
  | { ok: true; blocks: Block[] }
  | { ok: false; reason: UnplacedReason } {
  let remaining = task.durationMin;
  const chunks: { ms: MutableSlot; range: TimeRange }[] = [];
  let sawEligibleSlot = false;
  let spacingBlocked = false;

  for (const ms of slots) {
    if (remaining <= 0) break;

    const eligible = slotEligibility(task, ms, relaxEnergy);
    if (!eligible.ok) continue;
    sawEligibleSlot = true;

    if (task.spacing) {
      const last = spacing[task.spacing.groupKey];
      if (last !== undefined) {
        const candidate = absoluteMinute(ms.dayIndex, ms.slot.start);
        if (candidate - last < task.spacing.minHoursBetween * 60) {
          spacingBlocked = true;
          continue;
        }
      }
    }

    for (const range of usableRanges(task, ms)) {
      if (remaining <= 0) break;
      const available = range.end - range.start;
      if (available < minChunk) continue;

      const take = Math.min(remaining, available);
      if (!splittable && take < task.durationMin) continue;
      // never leave a fragment smaller than the minimum chunk
      if (splittable && remaining - take > 0 && remaining - take < minChunk) continue;

      const placed = { start: range.start, end: range.start + take };
      chunks.push({ ms, range: placed });
      remaining -= take;
    }
  }

  if (remaining > 0) {
    if (!sawEligibleSlot) {
      return { ok: false, reason: spacingBlocked ? "spacing_conflict" : "no_slot_in_time_window" };
    }
    if (spacingBlocked && chunks.length === 0) return { ok: false, reason: "spacing_conflict" };
    return { ok: false, reason: "no_slot_long_enough" };
  }

  for (const c of chunks) consume(c.ms, c.range);

  const blocks: Block[] = chunks.map((c, i) => ({
    taskId: task.id,
    title: task.title,
    domain: task.domain,
    date: c.ms.slot.date,
    start: c.range.start,
    end: c.range.end,
    sourceAgent: task.sourceAgent,
    ...(chunks.length > 1 ? { chunkIndex: i + 1, chunkCount: chunks.length } : {}),
  }));

  return { ok: true, blocks };
}
