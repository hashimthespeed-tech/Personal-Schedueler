/**
 * Training program.
 *
 * Adapted from the user's supplied plan with one structural change: the
 * original put Legs on Tuesday and Pull on Thursday, which are both practice
 * days ending at 17:30, while marking Wednesday — the freest weekday — as off.
 *
 * It also drops from five lifting days to four. Practice is training, and
 * period 6 is Team Sports every day (soccer, volleyball, badminton, played
 * hard). Five lifts plus two practices plus daily PE is a seven-day training
 * week with no rest, for a 125 lb athlete who is underfed and undersleeping.
 * That loses weight, which is the opposite of the goal.
 */

import type { Task } from "../core/types.js";
import { hm } from "../core/types.js";

/** Movements the ankle cannot currently tolerate. */
export const ANKLE_RESTRICTIONS = [
  "jumping",
  "lunge",
  "bulgarian-split-squat",
  "step-calf-raise",
] as const;

export interface Exercise {
  name: string;
  sets: number;
  /** null for to-failure bodyweight work */
  repRange: [number, number] | null;
  /** total pounds on the bar, or per-hand for dumbbell-style work */
  startingWeight: number | null;
  /** true for lower-body lifts — they progress in larger jumps */
  lower: boolean;
  movementTags: string[];
}

export type SessionName = "push" | "legs" | "pull" | "posterior-shoulders";

export interface Session {
  name: SessionName;
  label: string;
  /** 1 = Mon .. 7 = Sun */
  weekday: number;
  durationMin: number;
  exercises: Exercise[];
}

const BAR = 20;

export const PROGRAM: Session[] = [
  {
    name: "push",
    label: "Push",
    weekday: 1,
    durationMin: 60,
    exercises: [
      { name: "Bench press", sets: 4, repRange: [6, 10], startingWeight: BAR + 20, lower: false, movementTags: ["press"] },
      { name: "Overhead press (standing)", sets: 3, repRange: [6, 10], startingWeight: BAR, lower: false, movementTags: ["press"] },
      { name: "Bench dips (feet on floor)", sets: 3, repRange: null, startingWeight: null, lower: false, movementTags: ["press"] },
      { name: "Slow push-ups (3s down)", sets: 2, repRange: null, startingWeight: null, lower: false, movementTags: ["press"] },
    ],
  },
  {
    name: "legs",
    label: "Legs",
    weekday: 3,
    durationMin: 60,
    exercises: [
      { name: "Back squat", sets: 4, repRange: [10, 15], startingWeight: BAR + 50, lower: true, movementTags: ["squat"] },
      { name: "Romanian deadlift", sets: 4, repRange: [10, 12], startingWeight: BAR + 50, lower: true, movementTags: ["hinge"] },
      { name: "Goblet squat", sets: 3, repRange: [15, 15], startingWeight: 25, lower: true, movementTags: ["squat"] },
      { name: "Calf raises (flat ground)", sets: 3, repRange: [20, 20], startingWeight: null, lower: true, movementTags: ["calf-raise-flat"] },
    ],
  },
  {
    name: "pull",
    label: "Pull",
    weekday: 5,
    durationMin: 60,
    exercises: [
      { name: "Pull-ups", sets: 4, repRange: null, startingWeight: null, lower: false, movementTags: ["vertical-pull"] },
      { name: "Barbell row", sets: 4, repRange: [8, 12], startingWeight: BAR + 30, lower: false, movementTags: ["horizontal-pull"] },
      { name: "Chin-ups (underhand)", sets: 3, repRange: null, startingWeight: null, lower: false, movementTags: ["vertical-pull"] },
      { name: "Barbell curl", sets: 3, repRange: [10, 15], startingWeight: BAR + 20, lower: false, movementTags: ["curl"] },
    ],
  },
  {
    name: "posterior-shoulders",
    label: "Posterior + shoulders + core",
    weekday: 6,
    durationMin: 60,
    exercises: [
      { name: "Glute bridge (bar across hips)", sets: 3, repRange: [12, 15], startingWeight: BAR + 50, lower: true, movementTags: ["hinge"] },
      { name: "Single-leg RDL (holding plate)", sets: 3, repRange: [10, 10], startingWeight: 25, lower: true, movementTags: ["hinge", "single-leg"] },
      { name: "Lateral raises (10s hold)", sets: 4, repRange: [12, 15], startingWeight: 10, lower: false, movementTags: ["raise"] },
      { name: "Plate front raise", sets: 3, repRange: [12, 12], startingWeight: 15, lower: false, movementTags: ["raise"] },
      { name: "Hanging knee raises", sets: 3, repRange: null, startingWeight: null, lower: false, movementTags: ["core"] },
      { name: "Plank + side planks", sets: 3, repRange: null, startingWeight: null, lower: false, movementTags: ["core"] },
    ],
  },
];

/** Practice days. No lifting is scheduled here while in preseason. */
export const PRACTICE_WEEKDAYS = [2, 4];

/**
 * Lifting cannot start before the user is home and settled. On a practice day
 * that is 17:30; otherwise school ends mid-afternoon.
 */
const EARLIEST_LIFT = hm("15:45");
const LATEST_LIFT = hm("20:30");

export function sessionToTask(session: Session, weekOffset = 0): Task {
  return {
    id: `lift-${session.name}-w${weekOffset}`,
    domain: "physique",
    title: `Lift — ${session.label}`,
    notes: session.exercises.map((e) => e.name).join(", "),
    durationMin: session.durationMin,
    minChunkMin: null, // a training session is not splittable
    energy: "med",
    priority: 2,
    earliestTime: EARLIEST_LIFT,
    latestTime: LATEST_LIFT,
    allowedWeekdays: [session.weekday],
    spacing: { minHoursBetween: 24, groupKey: `lift-${session.name}` },
    sourceAgent: "coach",
    movementTags: session.exercises.flatMap((e) => e.movementTags),
  };
}

export function programTasks(weekOffset = 0): Task[] {
  return PROGRAM.map((s) => sessionToTask(s, weekOffset));
}
