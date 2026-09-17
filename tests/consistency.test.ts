import { describe, expect, it } from "vitest";
import { consistency, windowEnding, type LogRow } from "@/core/consistency";
import { coreSlots, dayFor, trackedSlots } from "@/core/routine";

const MON = "2026-09-14";
const TUE = "2026-09-15";
const WED = "2026-09-16";
const THU = "2026-09-17";

/** Every core hour on `date`, ticked done, optionally rated. */
function perfectDay(date: string, intensity: number | null = null): LogRow[] {
  return coreSlots(dayFor(date)).map((s) => ({
    onDate: date,
    slotKey: s.key,
    status: "done" as const,
    intensity,
  }));
}

describe("the window", () => {
  /**
   * The bug this exists for: a fortnight window on his second day counted
   * twelve days of pre-history as misses and reported 8%.
   */
  it("never starts before the first day he logged anything", () => {
    const score = consistency("2026-09-01", WED, perfectDay(WED));
    expect(score.from).toBe(WED);
    expect(score.days).toBe(1);
    expect(score.core).toBe(1);
  });

  it("keeps the asked-for start once there is history behind it", () => {
    const score = consistency(MON, WED, perfectDay(MON));
    expect(score.from).toBe(MON);
    expect(score.days).toBe(3);
  });

  it("returns zeros rather than NaN on an empty log", () => {
    const score = consistency(MON, WED, []);
    expect(score.from).toBe(MON);
    expect(score.core).toBe(0);
    expect(score.overall).toBe(0);
    expect(score.avgIntensity).toBeNull();
    expect(score.bestStreak).toBe(0);
    expect(score.slots.every((s) => s.rate === 0)).toBe(true);
  });

  it("spans exactly the dates in the grid", () => {
    const score = consistency(MON, THU, perfectDay(MON));
    expect(score.dates).toEqual([MON, TUE, WED, THU]);
    expect(new Set(score.grid.map((c) => c.date))).toEqual(new Set(score.dates));
  });
});

describe("scoring", () => {
  it("counts an unanswered day against the rate but reports it as silent", () => {
    // one day logged, three days of silence behind it
    const score = consistency(MON, THU, perfectDay(MON));
    const islam = score.slots.find((s) => s.key === "islam")!;

    expect(islam.scheduled).toBe(4);
    expect(islam.done).toBe(1);
    expect(islam.missed).toBe(0);
    expect(islam.silent).toBe(3);
    expect(islam.rate).toBeCloseTo(0.25);
  });

  it("separates a cross from a silence", () => {
    const rows: LogRow[] = [
      { onDate: MON, slotKey: "islam", status: "done" },
      { onDate: TUE, slotKey: "islam", status: "missed" },
      // Wednesday: never answered
    ];
    const score = consistency(MON, WED, rows);
    const islam = score.slots.find((s) => s.key === "islam")!;

    expect(islam.done).toBe(1);
    expect(islam.missed).toBe(1);
    expect(islam.silent).toBe(1);
    expect(islam.rate).toBeCloseTo(1 / 3);
  });

  it("scores a slot only on days it actually exists", () => {
    // practice is Tue/Thu; training is Mon/Wed/Fri/Sat
    const score = consistency(MON, THU, perfectDay(MON));
    const practice = score.slots.find((s) => s.key === "practice")!;
    const train = score.slots.find((s) => s.key === "train")!;

    expect(practice.scheduled).toBe(2);
    expect(train.scheduled).toBe(2);
  });

  it("ignores a row for a slot that does not exist that day", () => {
    const rows: LogRow[] = [
      ...perfectDay(MON),
      { onDate: MON, slotKey: "practice", status: "done" }, // Monday has no practice
    ];
    const score = consistency(MON, MON, rows);
    const practice = score.slots.find((s) => s.key === "practice");

    expect(practice).toBeUndefined();
    expect(score.core).toBe(1);
  });

  it("scores core separately from everything tracked", () => {
    // every core hour done, every prayer silent
    const score = consistency(MON, MON, perfectDay(MON));
    const day = dayFor(MON);

    expect(score.core).toBe(1);
    expect(score.overall).toBeCloseTo(coreSlots(day).length / trackedSlots(day).length);
    expect(score.overall).toBeLessThan(1);
  });
});

describe("streaks", () => {
  it("counts a day only when every core hour is done", () => {
    const rows = [...perfectDay(MON), ...perfectDay(TUE)];
    rows.pop(); // drop one of Tuesday's cores
    const score = consistency(MON, TUE, rows);

    expect(score.bestStreak).toBe(1);
    expect(score.currentStreak).toBe(0);
  });

  it("runs across consecutive complete days", () => {
    const score = consistency(MON, WED, [
      ...perfectDay(MON),
      ...perfectDay(TUE),
      ...perfectDay(WED),
    ]);
    expect(score.bestStreak).toBe(3);
    expect(score.currentStreak).toBe(3);
  });

  it("keeps the best run after the current one breaks", () => {
    const score = consistency(MON, THU, [
      ...perfectDay(MON),
      ...perfectDay(TUE),
      // Wednesday missed entirely
      ...perfectDay(THU),
    ]);
    expect(score.bestStreak).toBe(2);
    expect(score.currentStreak).toBe(1);
  });

  it("does not count a trailing silent day as a continuation", () => {
    const score = consistency(MON, TUE, perfectDay(MON));
    expect(score.currentStreak).toBe(0);
  });
});

describe("intensity", () => {
  it("averages only the sessions he rated", () => {
    const rows: LogRow[] = [
      { onDate: MON, slotKey: "islam", status: "done", intensity: 8 },
      { onDate: TUE, slotKey: "islam", status: "done", intensity: 6 },
      { onDate: WED, slotKey: "islam", status: "done" }, // ticked, not rated
    ];
    const score = consistency(MON, WED, rows);
    const islam = score.slots.find((s) => s.key === "islam")!;

    expect(islam.done).toBe(3);
    expect(islam.avgIntensity).toBe(7);
  });

  it("is null for a slot he never rated, and never zero", () => {
    const score = consistency(MON, MON, perfectDay(MON));
    expect(score.slots.every((s) => s.avgIntensity === null)).toBe(true);
    expect(score.avgIntensity).toBeNull();
  });

  it("carries the rating into its grid cell", () => {
    const score = consistency(MON, MON, [
      { onDate: MON, slotKey: "islam", status: "done", intensity: 9 },
    ]);
    const cell = score.grid.find((c) => c.slotKey === "islam" && c.date === MON)!;

    expect(cell.status).toBe("done");
    expect(cell.intensity).toBe(9);
  });

  it("averages across slots, not across days", () => {
    // two ratings on one day, one on the next — a flat mean of all three
    const score = consistency(MON, TUE, [
      { onDate: MON, slotKey: "islam", status: "done", intensity: 10 },
      { onDate: MON, slotKey: "school-work", status: "done", intensity: 4 },
      { onDate: TUE, slotKey: "islam", status: "done", intensity: 7 },
    ]);
    expect(score.avgIntensity).toBeCloseTo(7);
  });
});

describe("the grid", () => {
  it("has a cell for every tracked slot on every day", () => {
    const score = consistency(MON, WED, perfectDay(MON));
    const expected = score.dates.reduce((n, d) => n + trackedSlots(dayFor(d)).length, 0);
    expect(score.grid).toHaveLength(expected);
  });

  it("leaves an unanswered cell null rather than calling it missed", () => {
    const score = consistency(MON, MON, []);
    expect(score.grid.every((c) => c.status === null && c.intensity === null)).toBe(true);
  });
});

describe("windowEnding", () => {
  it("is inclusive of both ends", () => {
    expect(windowEnding(WED, 1)).toEqual({ from: WED, to: WED });
    expect(windowEnding(WED, 3)).toEqual({ from: MON, to: WED });
  });

  it("spans the number of days it was asked for", () => {
    const { from, to } = windowEnding(WED, 30);
    const score = consistency(from, to, perfectDay(from));
    expect(score.days).toBe(30);
  });
});
