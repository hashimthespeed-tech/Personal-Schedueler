import { describe, it, expect } from "vitest";
import { solve } from "../src/core/solver";
import { slotsForHorizon } from "../src/core/slots";
import { programTasks, ANKLE_RESTRICTIONS } from "../src/coach/program";
import { bedtimeFor } from "../src/core/sleep";
import { prayerBlocks } from "../src/core/prayer";
import type { Task } from "../src/core/types";
import { hm, overlaps, toHm } from "../src/core/types";

const MON = "2026-09-14";

function task(over: Partial<Task> & { id: string }): Task {
  return {
    domain: "school",
    title: over.id,
    durationMin: 60,
    energy: "med",
    priority: 3,
    sourceAgent: "tutor",
    ...over,
  };
}

function run(tasks: Task[], opts: { days?: number; maxUtilization?: number; restrictions?: string[] } = {}) {
  const days = opts.days ?? 7;
  return solve({
    startDate: MON,
    horizonDays: days,
    tasks,
    slots: slotsForHorizon(MON, days),
    maxUtilization: opts.maxUtilization ?? 0.7,
    restrictions: opts.restrictions,
  });
}

describe("solver placement", () => {
  it("places a simple task and reports honest utilization", () => {
    const r = run([task({ id: "hw" })]);
    expect(r.blocks).toHaveLength(1);
    expect(r.unplaced).toHaveLength(0);
    expect(r.scheduledMinutes).toBe(60);
    expect(r.utilization).toBeGreaterThan(0);
    expect(r.utilization).toBeLessThan(1);
  });

  it("never double-books a minute", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task({ id: `t${i}`, durationMin: 90 }));
    const r = run(tasks);
    for (const a of r.blocks) {
      for (const b of r.blocks) {
        if (a === b || a.date !== b.date) continue;
        expect(
          overlaps({ start: a.start, end: a.end }, { start: b.start, end: b.end }),
          `${a.title} overlaps ${b.title} on ${a.date}`,
        ).toBe(false);
      }
    }
  });

  it("never schedules past the bedtime wall", () => {
    const tasks = Array.from({ length: 20 }, (_, i) => task({ id: `t${i}`, durationMin: 60 }));
    for (const b of run(tasks).blocks) {
      expect(b.end, `${b.title} on ${b.date}`).toBeLessThanOrEqual(bedtimeFor(b.date));
    }
  });

  it("never schedules over a prayer block", () => {
    const tasks = Array.from({ length: 20 }, (_, i) => task({ id: `t${i}`, durationMin: 60 }));
    for (const b of run(tasks).blocks) {
      for (const p of prayerBlocks(b.date)) {
        expect(
          overlaps({ start: b.start, end: b.end }, { start: p.start, end: p.end }),
          `${b.title} overlaps ${p.label}`,
        ).toBe(false);
      }
    }
  });

  it("orders by deadline before priority", () => {
    const r = run([
      task({ id: "later-but-urgent", priority: 5, deadline: "2026-09-15" }),
      task({ id: "important-no-deadline", priority: 1 }),
    ]);
    const first = r.blocks[0];
    expect(first?.taskId).toBe("later-but-urgent");
  });

  it("refuses to place a task whose deadline has no room left", () => {
    const filler = Array.from({ length: 6 }, (_, i) =>
      task({ id: `filler${i}`, durationMin: 120, deadline: "2026-09-14", priority: 1 }),
    );
    const r = run([...filler, task({ id: "late", durationMin: 120, deadline: "2026-09-14", priority: 5 })]);
    const late = r.unplaced.find((u) => u.taskId === "late");
    expect(late).toBeDefined();
    expect(late?.detail).toMatch(/deadline|long enough|capacity/);
  });
});

describe("solver constraints", () => {
  it("keeps an unsplittable task in one contiguous block", () => {
    const r = run([task({ id: "exam-essay", durationMin: 150, minChunkMin: null })]);
    const blocks = r.blocks.filter((b) => b.taskId === "exam-essay");
    expect(blocks).toHaveLength(1);
    expect((blocks[0]?.end ?? 0) - (blocks[0]?.start ?? 0)).toBe(150);
  });

  it("splits a divisible task into chunks no smaller than its minimum", () => {
    const r = run([task({ id: "reading", durationMin: 300, minChunkMin: 45 })]);
    const blocks = r.blocks.filter((b) => b.taskId === "reading");
    expect(blocks.length).toBeGreaterThan(1);
    for (const b of blocks) expect(b.end - b.start).toBeGreaterThanOrEqual(45);
    const total = blocks.reduce((s, b) => s + (b.end - b.start), 0);
    expect(total).toBe(300);
  });

  it("honours a time-of-day window", () => {
    const r = run([
      task({ id: "evening-only", earliestTime: hm("19:00"), latestTime: hm("21:00") }),
    ]);
    const b = r.blocks[0];
    expect(b).toBeDefined();
    expect(b?.start).toBeGreaterThanOrEqual(hm("19:00"));
    expect(b?.end).toBeLessThanOrEqual(hm("21:00"));
  });

  it("honours allowed weekdays", () => {
    const r = run([task({ id: "wed-only", allowedWeekdays: [3] })]);
    expect(r.blocks[0]?.date).toBe("2026-09-16");
  });

  it("honours spacing between sessions in the same group", () => {
    const tasks = [1, 2, 3].map((n) =>
      task({
        id: `squat-${n}`,
        title: `Squat ${n}`,
        domain: "physique",
        durationMin: 60,
        spacing: { minHoursBetween: 48, groupKey: "squat" },
      }),
    );
    const r = run(tasks);
    const placed = r.blocks
      .filter((b) => b.taskId.startsWith("squat"))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    for (let i = 1; i < placed.length; i++) {
      const prev = placed[i - 1];
      const cur = placed[i];
      if (!prev || !cur) continue;
      const gapDays =
        (Date.parse(`${cur.date}T00:00:00Z`) - Date.parse(`${prev.date}T00:00:00Z`)) / 86400000;
      expect(gapDays, `${prev.date} -> ${cur.date}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps physique work off the at-school free period", () => {
    const r = run([
      task({
        id: "lift",
        domain: "physique",
        durationMin: 45,
        earliestTime: hm("14:00"),
        latestTime: hm("16:00"),
      }),
    ]);
    for (const b of r.blocks) {
      // the free period is 14:46-15:36; nothing physique may land inside it
      expect(overlaps({ start: b.start, end: b.end }, { start: hm("14:46"), end: hm("15:36") })).toBe(false);
    }
  });
});

describe("overcommitment reporting", () => {
  it("reports what did not fit, with a reason, instead of silently dropping it", () => {
    const tasks = Array.from({ length: 40 }, (_, i) =>
      task({ id: `t${i}`, durationMin: 120, priority: 3 }),
    );
    const r = run(tasks);
    expect(r.unplaced.length).toBeGreaterThan(0);
    for (const u of r.unplaced) {
      expect(u.detail.length).toBeGreaterThan(10);
      expect(u.reason).toBeTruthy();
    }
    expect(r.blocks.length + r.unplaced.length).toBe(tasks.length);
  });

  // Splittable work packs efficiently, so the utilization cap is what stops
  // it rather than fragmentation. This is the cap doing its actual job.
  it("stops at the utilization cap rather than filling every waking minute", () => {
    const tasks = Array.from({ length: 60 }, (_, i) =>
      task({ id: `t${i}`, durationMin: 60, minChunkMin: 20 }),
    );
    const r = run(tasks, { maxUtilization: 0.7 });
    expect(r.utilization).toBeGreaterThan(0.6);
    expect(r.utilization).toBeLessThanOrEqual(0.75);
    expect(r.unplaced.some((u) => u.reason === "horizon_full")).toBe(true);
  });

  it("names the cap explicitly so an overcommitted week is legible", () => {
    const tasks = Array.from({ length: 60 }, (_, i) =>
      task({ id: `t${i}`, durationMin: 60, minChunkMin: 20 }),
    );
    const capped = run(tasks, { maxUtilization: 0.7 }).unplaced.find(
      (u) => u.reason === "horizon_full",
    );
    expect(capped?.detail).toMatch(/capacity/);
    expect(capped?.detail).toMatch(/%/);
  });

  // Indivisible work loses real time to leftovers too small to reuse. Worth
  // asserting so the loss stays visible rather than being mistaken for a bug.
  it("loses capacity to fragmentation when nothing can be split", () => {
    const tasks = Array.from({ length: 60 }, (_, i) => task({ id: `t${i}`, durationMin: 60 }));
    const r = run(tasks, { maxUtilization: 0.7 });
    expect(r.unplaced.every((u) => u.reason === "no_slot_long_enough")).toBe(true);
    // stops well short of the cap purely because of leftover fragments
    expect(r.utilization).toBeLessThan(0.7);
  });

  it("protects high-priority work when the week is overcommitted", () => {
    const tasks = [
      task({ id: "critical", priority: 1, durationMin: 90 }),
      ...Array.from({ length: 40 }, (_, i) => task({ id: `noise${i}`, priority: 5, durationMin: 120 })),
    ];
    const r = run(tasks);
    expect(r.blocks.some((b) => b.taskId === "critical")).toBe(true);
  });
});

describe("ankle restrictions", () => {
  it("refuses any task using a restricted movement", () => {
    const r = run(
      [
        task({ id: "box-jumps", domain: "physique", movementTags: ["jumping"] }),
        task({ id: "split-squat", domain: "physique", movementTags: ["bulgarian-split-squat"] }),
        task({ id: "bench", domain: "physique", movementTags: ["press"] }),
      ],
      { restrictions: [...ANKLE_RESTRICTIONS] },
    );
    const blocked = r.unplaced.filter((u) => u.reason === "movement_restricted").map((u) => u.taskId);
    expect(blocked).toContain("box-jumps");
    expect(blocked).toContain("split-squat");
    expect(r.blocks.some((b) => b.taskId === "bench")).toBe(true);
  });

  it("clears the real program against the ankle restrictions", () => {
    const r = run(programTasks(), { restrictions: [...ANKLE_RESTRICTIONS] });
    expect(r.unplaced.filter((u) => u.reason === "movement_restricted")).toHaveLength(0);
  });
});

describe("training program placement", () => {
  it("places all four lifting sessions in a week", () => {
    const r = run(programTasks(), { restrictions: [...ANKLE_RESTRICTIONS] });
    expect(r.blocks.filter((b) => b.domain === "physique")).toHaveLength(4);
    expect(r.unplaced).toHaveLength(0);
  });

  // The supplied plan put Legs on Tuesday and Pull on Thursday, both practice
  // days ending at 17:30. The revised split must never do that in preseason.
  it("never puts a lift on a practice day", () => {
    const r = run(programTasks(), { restrictions: [...ANKLE_RESTRICTIONS] });
    for (const b of r.blocks.filter((x) => x.domain === "physique")) {
      const weekday = new Date(`${b.date}T12:00:00Z`).getUTCDay();
      expect([2, 4], `${b.title} landed on weekday ${weekday}`).not.toContain(weekday);
    }
  });

  it("puts every lift after school and before the evening winds down", () => {
    const r = run(programTasks(), { restrictions: [...ANKLE_RESTRICTIONS] });
    for (const b of r.blocks.filter((x) => x.domain === "physique")) {
      expect(b.start, `${b.title} at ${toHm(b.start)}`).toBeGreaterThanOrEqual(hm("15:45"));
      expect(b.end, `${b.title} ends ${toHm(b.end)}`).toBeLessThanOrEqual(hm("20:30"));
    }
  });
});
