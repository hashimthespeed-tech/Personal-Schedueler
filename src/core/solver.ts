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
  Recurrence,
  IsoDate,
  MinuteOfDay,
  Slot,
  SolverResult,
  Task,
  TimeRange,
  Unplaced,
  UnplacedReason,
} from "./types";
import { to12h } from "./types";
import { resolveDayPart } from "./dayparts";
import { DateTime } from "luxon";
import { energySatisfies } from "./energy";
import { datesBetween } from "./slots";

/**
 * Weekly ceiling. A backstop rather than the operative control — with the
 * per-day cap below at 0.6, a week can never exceed 0.6 either, so this only
 * binds if someone raises the daily cap.
 */
export const DEFAULT_MAX_UTILIZATION = 0.7;

/**
 * Per-day ceiling, as a share of that day's own free time.
 *
 * This is the control that actually shapes the week, and the one to change if
 * the plan feels too light or too heavy.
 *
 * Without it, greedy first-fit packs the earliest days solid — one run put
 * 8 hours on a Monday and 1.5 on the Tuesday after it. Both days were legal
 * and the week was only 27% booked; it was simply not a week anyone would
 * follow.
 *
 * Caveat worth knowing: weekend capacity is the weakest number in the model.
 * Weekdays subtract school, practice and commute, but a weekend day subtracts
 * only sleep, meals and prayer, so its "free" time is overstated and 60% of it
 * is still a lot. Adding real weekend commitments corrects this properly.
 */
export const DEFAULT_MAX_DAILY_UTILIZATION = 0.6;

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
  maxDailyUtilization?: number;
  /** last time each spacing group was satisfied, as an absolute minute */
  spacingHistory?: Record<string, number>;
}

interface MutableSlot {
  slot: Slot;
  dayIndex: number;
  free: TimeRange[];
}

/** Running per-day budget, so no single day absorbs the whole week. */
interface DayBudget {
  capacity: number;
  used: number;
  limit: number;
}

function absoluteMinute(dayIndex: number, minute: MinuteOfDay): number {
  return dayIndex * 1440 + minute;
}

function intersect(a: TimeRange, b: TimeRange): TimeRange | null {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return end > start ? { start, end } : null;
}

/**
 * The window a task may occupy on a given day.
 *
 * An explicit earliest/latest wins; otherwise a day part is resolved against
 * that date, so "bedtime" tracks the ramping bedtime and "after-school"
 * shifts on a practice day.
 */
function taskWindow(task: Task, slot: Slot): TimeRange {
  if (task.earliestTime !== undefined || task.latestTime !== undefined) {
    return { start: task.earliestTime ?? 0, end: task.latestTime ?? 1440 };
  }
  if (task.dayPart && task.dayPart !== "anytime") {
    const resolved = resolveDayPart(task.dayPart, slot.date, slot.weekday);
    if (resolved) return resolved;
  }
  return { start: 0, end: 1440 };
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
  if (task.pinnedDate && slot.date !== task.pinnedDate) {
    return { ok: false, reason: "no_slot_on_allowed_weekday" };
  }
  if (!intersect({ start: slot.start, end: slot.end }, taskWindow(task, slot))) {
    return { ok: false, reason: "no_slot_in_time_window" };
  }
  return { ok: true };
}

/** Usable sub-ranges of a slot for this task, clipped to its time window. */
function usableRanges(task: Task, ms: MutableSlot): TimeRange[] {
  const window = taskWindow(task, ms.slot);
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
  day_at_capacity: "the only days it could go are already full",
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
 * Order tasks for placement by least slack first.
 *
 * Slack is the free capacity a task could legally use, minus what it needs.
 * A lift that may only happen on Monday afternoon has very little; an essay
 * due Friday that could go anywhere has a great deal.
 *
 * This subsumes deadline urgency rather than competing with it: slots past a
 * deadline are not eligible, so a task due tomorrow already has less capacity
 * to draw on and sorts earlier on its own. Sorting by deadline first — as an
 * earlier version did — placed flexible schoolwork ahead of tightly
 * constrained training, and the training then had nowhere to go at 27%
 * utilization.
 */
function orderTasks(tasks: Task[], slots: MutableSlot[]): Task[] {
  const slack = new Map<string, number>();

  for (const t of tasks) {
    let capacity = 0;
    for (const ms of slots) {
      if (!slotEligibility(t, ms, true).ok) continue;
      for (const r of usableRanges(t, ms)) capacity += r.end - r.start;
    }
    slack.set(t.id, capacity - t.durationMin);
  }

  return [...tasks].sort((a, b) => {
    const sa = slack.get(a.id) ?? 0;
    const sb = slack.get(b.id) ?? 0;
    if (sa !== sb) return sa - sb;
    if (a.priority !== b.priority) return a.priority - b.priority;
    const da = a.deadline ?? "9999-12-31";
    const db = b.deadline ?? "9999-12-31";
    if (da !== db) return da < db ? -1 : 1;
    return b.durationMin - a.durationMin;
  });
}

/**
 * A training session is one per day, whether or not the agent said so.
 *
 * Left to the agent, four separate lifts landed on the same Monday — 6:30am,
 * then 4:25, 5:15, 6:05 and 7:40pm. Every one satisfied its own constraints;
 * nothing said they could not stack. Rather than rely on a prompt remembering
 * to set a spacing group every time, any substantial indivisible physique
 * session gets one by default.
 */
const SESSION_MIN_DURATION = 30;
const DEFAULT_SESSION_SPACING_HOURS = 20;

function normalizeTask(task: Task): Task {
  const isSession =
    task.domain === "physique" &&
    task.durationMin >= SESSION_MIN_DURATION &&
    (task.minChunkMin === null || task.minChunkMin === undefined);

  if (!isSession || task.spacing) return task;

  return {
    ...task,
    spacing: { minHoursBetween: DEFAULT_SESSION_SPACING_HOURS, groupKey: "physique-session" },
  };
}

const RECURRENCE_WEEKDAYS: Record<Recurrence, number[] | null> = {
  once: null,
  daily: [1, 2, 3, 4, 5, 6, 7],
  weekdays: [1, 2, 3, 4, 5],
  weekends: [6, 7],
  weekly: null,
};

/**
 * Turn a recurring task into one pinned instance per eligible day.
 *
 * Without this a daily habit is a single task: a morning weigh-in got placed
 * once, on a Tuesday, and never again. Expanding here keeps the solver itself
 * unaware of recurrence — every instance is an ordinary pinned task.
 */
export function expandRecurring(tasks: Task[], dates: IsoDate[]): Task[] {
  const out: Task[] = [];

  for (const task of tasks) {
    const rule = task.recurrence ?? "once";
    const weekdays = RECURRENCE_WEEKDAYS[rule];

    if (rule === "once" || weekdays === null) {
      out.push(task);
      continue;
    }

    for (const date of dates) {
      const weekday = DateTime.fromISO(date).weekday;
      if (!weekdays.includes(weekday)) continue;
      if (task.allowedWeekdays && !task.allowedWeekdays.includes(weekday)) continue;
      out.push({
        ...task,
        id: `${task.id}@${date}`,
        pinnedDate: date,
        recurrence: "once",
      });
    }
  }

  return out;
}

export function solve(input: SolverInput): SolverResult {
  const maxUtilization = input.maxUtilization ?? DEFAULT_MAX_UTILIZATION;
  const restrictions = new Set(input.restrictions ?? []);
  const dates = datesBetween(input.startDate, input.horizonDays);
  const dayIndexOf = new Map(dates.map((d, i) => [d, i]));

  const expanded = expandRecurring(input.tasks.map(normalizeTask), dates);

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

  const maxDaily = input.maxDailyUtilization ?? DEFAULT_MAX_DAILY_UTILIZATION;
  const dayBudgets = new Map<string, DayBudget>();
  for (const m of mutable) {
    const entry = dayBudgets.get(m.slot.date) ?? { capacity: 0, used: 0, limit: 0 };
    entry.capacity += m.slot.end - m.slot.start;
    dayBudgets.set(m.slot.date, entry);
  }
  for (const entry of dayBudgets.values()) {
    entry.limit = Math.floor(entry.capacity * maxDaily);
  }

  const blocks: Block[] = [];
  const unplaced: Unplaced[] = [];
  const spacing: Record<string, number> = { ...(input.spacingHistory ?? {}) };
  let scheduledMinutes = 0;

  // restricted movements never reach the solver proper
  const admissible: Task[] = [];
  for (const task of expanded) {
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

    const placed = placeTask(task, mutable, spacing, blocks, dayBudgets);
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
  dayBudgets: Map<string, DayBudget>,
): { ok: true } | { ok: false; reason: UnplacedReason } {
  const splittable = task.minChunkMin != null && task.minChunkMin < task.durationMin;
  const minChunk = splittable ? (task.minChunkMin ?? task.durationMin) : task.durationMin;

  // Strict energy match first, then a downgrade rather than dropping it.
  //
  // The day cap is only ever relaxed for work with a hard deadline. Without
  // that restriction every task falls through to the relaxed pass and the cap
  // stops meaning anything — one run put 89% of a Monday's free time on that
  // Monday. Work with no deadline is better left unplaced and reported than
  // silently piled onto an already-full day.
  const mayOverfillDay = task.deadline !== undefined;
  let lastReason: UnplacedReason = "no_slot_long_enough";

  for (const relaxEnergy of [false, true]) {
    for (const respectDayCap of mayOverfillDay ? [true, false] : [true]) {
      const attempt = tryPlace(task, slots, spacing, minChunk, splittable, relaxEnergy, respectDayCap ? dayBudgets : null);
      if (!attempt.ok) {
        const retryable =
          attempt.reason === "no_slot_in_time_window" ||
          attempt.reason === "no_slot_long_enough" ||
          attempt.reason === "day_at_capacity";
        if (!retryable) return { ok: false, reason: attempt.reason };
        lastReason = attempt.reason;
        continue;
      }
      for (const b of attempt.blocks) {
        const entry = dayBudgets.get(b.date);
        if (entry) entry.used += b.end - b.start;
      }
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
  }

  return { ok: false, reason: lastReason };
}

function tryPlace(
  task: Task,
  slots: MutableSlot[],
  spacing: Record<string, number>,
  minChunk: number,
  splittable: boolean,
  relaxEnergy: boolean,
  dayBudgets: Map<string, DayBudget> | null,
):
  | { ok: true; blocks: Block[] }
  | { ok: false; reason: UnplacedReason } {
  let remaining = task.durationMin;
  const chunks: { ms: MutableSlot; range: TimeRange }[] = [];
  let sawEligibleSlot = false;
  let spacingBlocked = false;
  let dayCapBlocked = false;

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

    const budget = dayBudgets?.get(ms.slot.date);
    const takenToday = chunks
      .filter((c) => c.ms.slot.date === ms.slot.date)
      .reduce((sum, c) => sum + (c.range.end - c.range.start), 0);
    let dayHeadroom = budget ? budget.limit - budget.used - takenToday : Number.POSITIVE_INFINITY;
    if (budget && dayHeadroom < minChunk) {
      dayCapBlocked = true;
      continue;
    }

    for (const range of usableRanges(task, ms)) {
      if (remaining <= 0) break;
      const available = Math.min(range.end - range.start, dayHeadroom);
      if (available < minChunk) continue;

      const take = Math.min(remaining, available);
      if (!splittable && take < task.durationMin) continue;
      // never leave a fragment smaller than the minimum chunk
      if (splittable && remaining - take > 0 && remaining - take < minChunk) continue;

      const placed = { start: range.start, end: range.start + take };
      chunks.push({ ms, range: placed });
      remaining -= take;
      dayHeadroom -= take;
    }
  }

  if (remaining > 0) {
    if (!sawEligibleSlot) {
      return { ok: false, reason: spacingBlocked ? "spacing_conflict" : "no_slot_in_time_window" };
    }
    if (spacingBlocked && chunks.length === 0) return { ok: false, reason: "spacing_conflict" };
    // a day already at its cap is a different problem from a day with no room,
    // and the distinction matters on a screen showing visibly empty time
    if (dayCapBlocked) return { ok: false, reason: "day_at_capacity" };
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
