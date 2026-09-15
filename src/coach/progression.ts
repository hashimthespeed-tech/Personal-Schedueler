/**
 * Progression and load math. Deterministic — never ask a language model to do
 * arithmetic it will do inconsistently.
 *
 * Rule, from the user's plan: when every set hits the top of the rep range,
 * add weight next session. Upper body nominally +10 lb, but there are no 5 lb
 * plates, so the smallest symmetrical jump is +20 lb and the rep range resets
 * to the bottom. Lower body +20 lb.
 */

import type { Exercise } from "./program.js";

/** Plates on hand, per side. */
export const PLATE_INVENTORY = [10, 15, 25] as const;
export const BAR_WEIGHT = 20;

/** Bar plus every plate loaded: 20 + 2*(10+15+25). */
export const MAX_LOAD = BAR_WEIGHT + 2 * (10 + 15 + 25);

export const UPPER_INCREMENT = 20;
export const LOWER_INCREMENT = 20;

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

  const increment = exercise.lower ? LOWER_INCREMENT : UPPER_INCREMENT;
  const target = lastWeight + increment;
  const loadable = nextLoadableWeight(target);

  if (loadable === null || loadable > MAX_LOAD) {
    return {
      exerciseName: exercise.name,
      weight: lastWeight,
      targetReps: exercise.repRange,
      note: `out of plates at ${lastWeight} lb — slow to a 4s lowering, add a pause, push past 20 reps`,
      atCeiling: true,
    };
  }

  return {
    exerciseName: exercise.name,
    weight: loadable,
    // reset to the bottom of the range after a jump
    targetReps: [exercise.repRange[0], exercise.repRange[1]],
    note: `+${loadable - lastWeight} lb — back to ${exercise.repRange[0]} reps`,
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
  const increment = exercise.lower ? LOWER_INCREMENT : UPPER_INCREMENT;
  const headroom = MAX_LOAD - currentWeight;
  if (headroom <= 0) return 0;
  const jumpsLeft = Math.floor(headroom / increment);
  return jumpsLeft * sessionsPerJump;
}
