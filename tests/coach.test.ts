import { describe, it, expect } from "vitest";
import {
  nextPrescription,
  isLoadable,
  loadableWeights,
  nextLoadableWeight,
  sessionsUntilCeiling,
  stepUpFrom,
  plateGappedLifts,
  MAX_LOAD,
  BAR_WEIGHT,
  type ExerciseLog,
} from "../src/coach/progression.js";
import { evaluateGate, bodyweightTrend } from "../src/coach/gating.js";
import { PROGRAM, ANKLE_RESTRICTIONS, type Exercise } from "../src/coach/program.js";

const squat: Exercise = {
  name: "Back squat", sets: 4, repRange: [10, 15], startingWeight: 70, lower: true, movementTags: ["squat"],
};
const bench: Exercise = {
  name: "Bench press", sets: 4, repRange: [6, 10], startingWeight: 40, lower: false, movementTags: ["press"],
};
const pullups: Exercise = {
  name: "Pull-ups", sets: 4, repRange: null, startingWeight: null, lower: false, movementTags: ["vertical-pull"],
};

function log(weight: number | null, reps: number[], date = "2026-09-14"): ExerciseLog {
  return { exerciseName: "x", date, sets: reps.map((r) => ({ reps: r, weight })) };
}

describe("plate inventory", () => {
  // bar 20 + 2 * (10 + 15 + 25)
  it("knows the real ceiling", () => {
    expect(MAX_LOAD).toBe(120);
  });

  it("only allows loads that can actually be built from the plates on hand", () => {
    expect(isLoadable(BAR_WEIGHT)).toBe(true);
    expect(isLoadable(40)).toBe(true);   // 10 a side
    expect(isLoadable(50)).toBe(true);   // 15 a side
    expect(isLoadable(70)).toBe(true);   // 25 a side
    expect(isLoadable(120)).toBe(true);  // everything
    expect(isLoadable(30)).toBe(false);  // would need a 5
    expect(isLoadable(130)).toBe(false); // past the ceiling
  });

  // One 10, one 15 and one 25 per side. 60 and 80 are not reachable: they
  // would need a second 10 or a second 15 on each side.
  it("enumerates every buildable load", () => {
    expect(loadableWeights()).toEqual([20, 40, 50, 70, 90, 100, 120]);
  });

  it("rounds a target up to a buildable load", () => {
    expect(nextLoadableWeight(75)).toBe(90);
    expect(nextLoadableWeight(110)).toBe(120);
    expect(nextLoadableWeight(125)).toBe(null);
  });

  it("steps to the next buildable weight above the current one", () => {
    expect(stepUpFrom(40)).toBe(50);
    expect(stepUpFrom(70)).toBe(90);
    expect(stepUpFrom(120)).toBe(null);
  });
});

describe("progression rule", () => {
  it("starts at the programmed weight with no history", () => {
    expect(nextPrescription(squat, null).weight).toBe(70);
  });

  it("holds when the top of the range was not reached on every set", () => {
    const p = nextPrescription(squat, log(70, [15, 15, 15, 12]));
    expect(p.weight).toBe(70);
    expect(p.note).toMatch(/hold/);
  });

  it("adds load when every set hit the top of the range", () => {
    const p = nextPrescription(squat, log(70, [15, 15, 15, 15]));
    expect(p.weight).toBe(90);
    expect(p.note).toMatch(/\+20 lb/);
    expect(p.targetReps?.[0]).toBe(10);
  });

  // Swapping plates beats adding them: 40 lb on 10s becomes 50 lb on 15s,
  // which is the nominal +10 the plan wanted and assumed was impossible.
  it("finds the +10 upper-body step by swapping plates, not adding them", () => {
    const p = nextPrescription(bench, log(40, [10, 10, 10, 10]));
    expect(p.weight).toBe(50);
    expect(p.note).toMatch(/\+10 lb/);
    expect(p.note).toMatch(/back to 6 reps/);
  });

  // Overhead press starts at bar weight. The next buildable load is 40 lb —
  // double. Prescribing it would guarantee missed reps.
  it("refuses a jump the athlete would miss and names the equipment gap", () => {
    const ohp: Exercise = {
      name: "Overhead press", sets: 3, repRange: [6, 10],
      startingWeight: 20, lower: false, movementTags: ["press"],
    };
    const p = nextPrescription(ohp, log(20, [10, 10, 10]));
    expect(p.weight).toBe(20);
    expect(p.plateGapped).toBe(true);
    expect(p.atCeiling).toBe(false);
    expect(p.note).toMatch(/5 lb plates/);
  });

  it("reports which lifts are blocked by the plate set", () => {
    const gapped = plateGappedLifts([
      { exercise: bench, currentWeight: 40 },
      { exercise: squat, currentWeight: 70 },
      { exercise: { ...bench, name: "Barbell row", startingWeight: 50 }, currentWeight: 50 },
    ]);
    expect(gapped.map((g) => g.name)).toEqual(["Barbell row"]);
    expect(gapped[0]?.nextBuildable).toBe(70);
  });

  it("progresses bodyweight work by reps, not load", () => {
    const p = nextPrescription(pullups, log(null, [8, 7, 6, 5]));
    expect(p.weight).toBeNull();
    expect(p.note).toMatch(/total reps/);
  });

  it("never prescribes more than the plates allow", () => {
    const p = nextPrescription(squat, log(120, [15, 15, 15, 15]));
    expect(p.weight).toBe(120);
    expect(p.atCeiling).toBe(true);
    expect(p.note).toMatch(/out of plates/);
    expect(p.note).toMatch(/4s|pause|20 reps/);
  });

  it("holds load when the volume gate is closed, even at the top of the range", () => {
    const p = nextPrescription(squat, log(70, [15, 15, 15, 15]), false);
    expect(p.weight).toBe(70);
    expect(p.note).toMatch(/not eating or sleeping/);
  });
});

describe("plate ceiling projection", () => {
  // The ladder from 70 is 90, 100, 120 — three jumps, unevenly sized.
  it("walks the real plate ladder rather than assuming an even step", () => {
    expect(sessionsUntilCeiling(squat, 70, 3)).toBe(9);
    expect(sessionsUntilCeiling(squat, 100, 2)).toBe(2);
  });

  it("reports zero once already at the ceiling", () => {
    expect(sessionsUntilCeiling(squat, 120, 3)).toBe(0);
  });

  it("returns null when not progressing at all", () => {
    expect(sessionsUntilCeiling(squat, 70, 0)).toBeNull();
  });
});

describe("volume gating", () => {
  const gaining = [
    { date: "2026-09-01", lb: 125 }, { date: "2026-09-04", lb: 125.6 },
    { date: "2026-09-08", lb: 126.2 }, { date: "2026-09-12", lb: 126.9 },
  ];
  const flat = [
    { date: "2026-09-01", lb: 125 }, { date: "2026-09-04", lb: 125.1 },
    { date: "2026-09-08", lb: 124.9 }, { date: "2026-09-12", lb: 125 },
  ];
  const enough = [480, 485, 470, 490, 480];
  const short = [400, 395, 410, 390, 400];

  it("measures the bodyweight trend in lb per week", () => {
    const trend = bodyweightTrend(gaining);
    expect(trend).not.toBeNull();
    expect(trend ?? 0).toBeGreaterThan(0.8);
    expect(trend ?? 0).toBeLessThan(1.6);
  });

  it("allows progression when gaining and sleeping", () => {
    const g = evaluateGate({ recentWeights: gaining, recentNetSleepMin: enough, targetSleepMin: 480 });
    expect(g.verdict).toBe("progress");
    expect(g.allowProgression).toBe(true);
  });

  // The supplied plan's own closing point: "You're underfed. Training without
  // fixing this does almost nothing." Encoded as a gate, not as advice.
  it("holds and escalates eating when the scale is flat", () => {
    const g = evaluateGate({ recentWeights: flat, recentNetSleepMin: enough, targetSleepMin: 480 });
    expect(g.verdict).toBe("hold-and-escalate");
    expect(g.allowProgression).toBe(false);
    expect(g.reason).toMatch(/eat more/);
  });

  it("holds when sleep is short even if the scale is moving", () => {
    const g = evaluateGate({ recentWeights: gaining, recentNetSleepMin: short, targetSleepMin: 480 });
    expect(g.verdict).toBe("hold");
    expect(g.allowProgression).toBe(false);
    expect(g.reason).toMatch(/sleep target/);
  });

  // The user's current state: 23:00 to 06:00 is 6h40m net after Fajr.
  it("closes the gate at the user's current actual sleep", () => {
    const g = evaluateGate({ recentWeights: gaining, recentNetSleepMin: [400], targetSleepMin: 480 });
    expect(g.allowProgression).toBe(false);
    expect(g.reason).toMatch(/1\.3h under/);
  });
});

describe("program structure", () => {
  it("runs four lifting days, not five", () => {
    expect(PROGRAM).toHaveLength(4);
  });

  it("never schedules a lift on a practice day", () => {
    const practiceDays = [2, 4];
    for (const session of PROGRAM) {
      expect(practiceDays, session.label).not.toContain(session.weekday);
    }
  });

  it("uses Wednesday, which the supplied plan wasted as a rest day", () => {
    expect(PROGRAM.find((s) => s.name === "legs")?.weekday).toBe(3);
  });

  it("contains no movement the ankle cannot tolerate", () => {
    const restricted = new Set<string>(ANKLE_RESTRICTIONS);
    for (const session of PROGRAM) {
      for (const ex of session.exercises) {
        for (const tag of ex.movementTags) {
          expect(restricted.has(tag), `${ex.name} uses ${tag}`).toBe(false);
        }
      }
    }
  });

  const BARBELL_LIFTS = [
    "Bench press", "Overhead press (standing)", "Back squat",
    "Romanian deadlift", "Barbell row", "Barbell curl",
    "Glute bridge (bar across hips)",
  ];

  it("starts every barbell lift at a weight that can actually be built", () => {
    for (const session of PROGRAM) {
      for (const ex of session.exercises) {
        if (ex.startingWeight === null) continue;
        if (!BARBELL_LIFTS.includes(ex.name)) continue;
        expect(isLoadable(ex.startingWeight), `${ex.name} at ${ex.startingWeight}`).toBe(true);
      }
    }
  });
});
