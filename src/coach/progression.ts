/**
 * Progression and load math. Deterministic — never ask a language model to do
 * arithmetic it will do inconsistently.
 *
 * Rule, from the user's plan: when every set hits the top of the rep range,
 * add weight next session. Nominally +10 lb upper, +20 lb lower.
 *
 * The plan assumes a smooth weight ladder. The user's plates do not provide
 * one. With a single 10, 15 and 25 per side the only buildable loads are
 * 20, 40, 50, 70, 90, 100 and 120 — so some lifts have no next step small
 * enough to actually make.
 *
 * The plan also missed that swapping plates gives finer increments than
 * adding them: 40 lb (10s) to 50 lb (15s) is a +10 jump, not the +20 it
 * assumed. That recovers normal progression on bench and curls.
 *
 * Where no acceptable step exists — overhead press at bar weight would have
 * to double — the prescription holds the load and progresses reps and tempo
 * instead, and says plainly that plates are the limiter. Prescribing a jump
 * the athlete will fail is worse than saying the equipment is the problem.
 */

import type { Exercise } from "./program";

/** Plates on hand, per side. */
export const PLATE_INVENTORY = [10, 15, 25] as const;
export const BAR_WEIGHT = 20;

/** Bar plus every plate loaded: 20 + 2*(10+15+25). */
export const MAX_LOAD = BAR_WEIGHT + 2 * (10 + 15 + 25);

export const UPPER_INCREMENT = 10;
export const LOWER_INCREMENT = 20;

/**
 * A jump is acceptable if it is no larger than the nominal increment for that
 * lift, or 15% of the current load, whichever is more forgiving. Beyond that
 * the athlete will simply miss the reps.
 */
export function isAcceptableJump(current: number, next: number, lower: boolean): boolean {
  const nominal = lower ? LOWER_INCREMENT : UPPER_INCREMENT;
  return next - current <= Math.max(nominal, current * 0.15);
}

export interface SetLog {
  reps: number;
  weight: number | null;
}

export interface ExerciseLog {
  exerciseName: string;
  sets: SetLog[];
  date: string;
}

export interface Prescription {
  exerciseName: string;
  weight: number | null;
  targetReps: [number, number] | null;
  /** why the weight changed, shown verbatim in the UI */
  note: string;
  atCeiling: boolean;
  /**
   * True when the athlete earned more load but no buildable plate combination
   * provides a jump small enough to make. The equipment is the limiter, not
   * the athlete.
   */
  plateGapped?: boolean;
}

/** Can this total load actually be built from the bar and plates on hand? */
export function isLoadable(total: number): boolean {
  if (total === BAR_WEIGHT) return true;
  const perSide = (total - BAR_WEIGHT) / 2;
  if (perSide <= 0 || !Number.isInteger(perSide)) return false;

  const reachable = new Set<number>([0]);
  for (const plate of PLATE_INVENTORY) {
    for (const existing of [...reachable]) reachable.add(existing + plate);
  }
  return reachable.has(perSide);
}

/** Every total load the user can actually assemble, ascending. */
export function loadableWeights(): number[] {
  const perSide = new Set<number>([0]);
  for (const plate of PLATE_INVENTORY) {
    for (const existing of [...perSide]) perSide.add(existing + plate);
  }
  return [...perSide].map((p) => BAR_WEIGHT + 2 * p).sort((a, b) => a - b);
}

/** Round a target up to the next load that can actually be built. */
export function nextLoadableWeight(target: number): number | null {
  const options = loadableWeights();
  for (const w of options) if (w >= target) return w;
  return null;
}

/** The smallest buildable load strictly heavier than `current`. */
export function stepUpFrom(current: number): number | null {
  for (const w of loadableWeights()) if (w > current) return w;
  return null;
}

function hitTopOfRange(log: ExerciseLog, exercise: Exercise): boolean {
  if (!exercise.repRange) return false;
  const top = exercise.repRange[1];
  if (log.sets.length < exercise.sets) return false;
  return log.sets.every((s) => s.reps >= top);
}

/**
 * Next session's prescription for one exercise.
 *
 * `allowProgression` is the volume gate — when the athlete is not gaining
 * weight or not sleeping, load holds rather than climbing.
 */
export function nextPrescription(
  exercise: Exercise,
  lastLog: ExerciseLog | null,
  allowProgression = true,
): Prescription {
  const base: Prescription = {
    exerciseName: exercise.name,
    weight: exercise.startingWeight,
    targetReps: exercise.repRange,
    note: "starting weight",
    atCeiling: false,
  };

  if (!lastLog || lastLog.sets.length === 0) return base;

  const lastWeight = lastLog.sets[0]?.weight ?? exercise.startingWeight;

  // bodyweight work progresses by reps, not load
  if (lastWeight === null || !exercise.repRange) {
    return {
      ...base,
      weight: null,
      note: "bodyweight — beat last session's total reps",
    };
  }

  if (!hitTopOfRange(lastLog, exercise)) {
    return {
      ...base,
      weight: lastWeight,
      note: "hold — beat it by a rep",
    };
  }

  if (!allowProgression) {
    return {
      ...base,
      weight: lastWeight,
      note: "hold — not eating or sleeping enough to earn more load",
    };
  }

  const next = stepUpFrom(lastWeight);

  if (next === null || next > MAX_LOAD) {
    return {
      exerciseName: exercise.name,
      weight: lastWeight,
      targetReps: exercise.repRange,
      note: `out of plates at ${lastWeight} lb — slow to a 4s lowering, add a pause, push past 20 reps`,
      atCeiling: true,
    };
  }

  if (!isAcceptableJump(lastWeight, next, exercise.lower)) {
    const jump = next - lastWeight;
    return {
      exerciseName: exercise.name,
      weight: lastWeight,
      targetReps: exercise.repRange,
      note: `earned more load, but the next buildable weight is ${next} lb — a ${jump} lb jump you would miss. Hold ${lastWeight} lb, slow the lowering and add reps. A pair of 5 lb plates fixes this lift.`,
      atCeiling: false,
      plateGapped: true,
    };
  }

  return {
    exerciseName: exercise.name,
    weight: next,
    // reset to the bottom of the range after a jump
    targetReps: [exercise.repRange[0], exercise.repRange[1]],
    note: `+${next - lastWeight} lb — back to ${exercise.repRange[0]} reps`,
    atCeiling: false,
  };
}

/**
 * When the plate ceiling will be reached for one exercise, given how fast it
 * has actually been climbing. Returns null when it is not progressing.
 *
 * The plan guesses "about 8 weeks" — this replaces the guess with the user's
 * own rate so the warning lands before the wall, not after.
 */
export function sessionsUntilCeiling(
  exercise: Exercise,
  currentWeight: number,
  sessionsPerJump: number,
): number | null {
  if (sessionsPerJump <= 0) return null;
  if (currentWeight >= MAX_LOAD) return 0;

  // walk the actual buildable ladder — the steps are not evenly sized
  let weight = currentWeight;
  let jumps = 0;
  for (;;) {
    const next = stepUpFrom(weight);
    if (next === null || next > MAX_LOAD) break;
    if (!isAcceptableJump(weight, next, exercise.lower)) break;
    weight = next;
    jumps += 1;
  }
  return jumps * sessionsPerJump;
}

/**
 * Lifts whose next step is unreachable with the plates on hand. Surfaces the
 * equipment gap as a concrete shopping list rather than a mystery plateau.
 */
export function plateGappedLifts(
  entries: { exercise: Exercise; currentWeight: number | null }[],
): { name: string; currentWeight: number; nextBuildable: number }[] {
  const out: { name: string; currentWeight: number; nextBuildable: number }[] = [];
  for (const { exercise, currentWeight } of entries) {
    if (currentWeight === null) continue;
    const next = stepUpFrom(currentWeight);
    if (next === null || next > MAX_LOAD) continue;
    if (isAcceptableJump(currentWeight, next, exercise.lower)) continue;
    out.push({ name: exercise.name, currentWeight, nextBuildable: next });
  }
  return out;
}
