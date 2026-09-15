import { describe, it, expect } from "vitest";
import { solve, expandRecurring } from "../src/core/solver";
import { slotsForHorizon } from "../src/core/slots";
import { resolveDayPart } from "../src/core/dayparts";
import { datesBetween } from "../src/core/slots";
import type { Task } from "../src/core/types";
import { hm, to12h } from "../src/core/types";

const MON = "2026-09-14";

function task(over: Partial<Task> & { id: string }): Task {
  return {
    domain: "physique",
    title: over.id,
    durationMin: 20,
    minChunkMin: null,
    energy: "low",
    priority: 1,
    sourceAgent: "coach",
    ...over,
  };
}

function run(tasks: Task[]) {
  return solve({ startDate: MON, horizonDays: 7, tasks, slots: slotsForHorizon(MON, 7) });
}

describe("recurrence", () => {
  it("expands a daily task to one instance per day", () => {
    const expanded = expandRecurring([task({ id: "weigh", recurrence: "daily" })], datesBetween(MON, 7));
    expect(expanded).toHaveLength(7);
    expect(new Set(expanded.map((t) => t.pinnedDate)).size).toBe(7);
  });

  it("expands weekdays to five", () => {
    const expanded = expandRecurring([task({ id: "feed", recurrence: "weekdays" })], datesBetween(MON, 7));
    expect(expanded).toHaveLength(5);
  });

  it("leaves a one-off alone", () => {
    const expanded = expandRecurring([task({ id: "x" })], datesBetween(MON, 7));
    expect(expanded).toHaveLength(1);
    expect(expanded[0]?.pinnedDate).toBeUndefined();
  });

  // A habit emitted as one-off got placed on a single arbitrary day and never
  // appeared again — the weigh-in the whole coach gate depends on.
  it("places a daily habit every single day", () => {
    const r = run([task({ id: "weigh", durationMin: 5, dayPart: "morning", recurrence: "daily" })]);
    const days = new Set(r.blocks.map((b) => b.date));
    expect(days.size).toBe(7);
    expect(r.unplaced).toHaveLength(0);
  });
});

describe("day parts", () => {
  it("puts a bedtime task in the last stretch before the wall, not the morning", () => {
    const r = run([task({ id: "winddown", dayPart: "bedtime", recurrence: "daily" })]);
    for (const b of r.blocks) {
      expect(b.start, `${b.date} ${to12h(b.start)}`).toBeGreaterThan(hm("20:00"));
    }
  });

  it("puts a morning task before school", () => {
    const r = run([task({ id: "bfast", durationMin: 15, dayPart: "morning", recurrence: "weekdays" })]);
    for (const b of r.blocks) {
      expect(b.end, `${b.date} ${to12h(b.end)}`).toBeLessThanOrEqual(hm("08:05"));
    }
  });

  // The failure that motivated day parts: "post-school feed" with no window
  // was scheduled at 7:20 AM.
  it("never puts an after-school task in the morning", () => {
    const r = run([task({ id: "feed", dayPart: "after-school", recurrence: "weekdays" })]);
    expect(r.blocks.length).toBeGreaterThan(0);
    for (const b of r.blocks) {
      expect(b.start, `${b.date} ${to12h(b.start)}`).toBeGreaterThan(hm("12:00"));
    }
  });

  it("shifts after-school later on a practice day", () => {
    const monday = resolveDayPart("after-school", "2026-09-14", 1);
    const tuesday = resolveDayPart("after-school", "2026-09-15", 2);
    expect(tuesday?.start ?? 0).toBeGreaterThan(monday?.start ?? 0);
    expect(tuesday?.start).toBe(hm("17:30"));
  });
});

describe("one training session a day", () => {
  // Three lifts with no spacing all landed on the same Monday — four sessions
  // in one day, every one of them individually legal.
  it("never stacks two sessions on one day, even with no spacing set", () => {
    const lifts = ["A", "B", "C"].map((n) =>
      task({
        id: `lift${n}`,
        title: `Full-body lift ${n}`,
        durationMin: 50,
        energy: "med",
        priority: 2,
        allowedWeekdays: [1, 3, 5, 6],
      }),
    );
    const r = run(lifts);

    const perDay = new Map<string, number>();
    for (const b of r.blocks) perDay.set(b.date, (perDay.get(b.date) ?? 0) + 1);
    for (const [date, n] of perDay) {
      expect(n, `${date} has ${n} sessions`).toBe(1);
    }
    expect(r.blocks).toHaveLength(3);
  });

  it("still allows short physique habits alongside a session", () => {
    const r = run([
      task({ id: "lift", title: "Lift", durationMin: 50, energy: "med", priority: 2, allowedWeekdays: [1] }),
      task({ id: "weigh", durationMin: 5, dayPart: "morning", recurrence: "daily" }),
    ]);
    const monday = r.blocks.filter((b) => b.date === MON);
    expect(monday.length).toBeGreaterThan(1);
  });
});
