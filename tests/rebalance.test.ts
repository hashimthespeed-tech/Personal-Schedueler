import { describe, expect, it } from "vitest";
import { rebalanceAfterDeletion, rebalanceFreedSlot, type RebalanceTask } from "../src/core/rebalance";

function task(id: number, startMin: number, durationMin: number,
  approvedCosts: RebalanceTask["approvedCosts"]): RebalanceTask {
  return { id, title: `Task ${id}`, startMin, durationMin, status: "planned", approvedCosts };
}

describe("early-completion rebalancing", () => {
  it("restores sleep before wind-down and splits only the amount that fits", () => {
    const result = rebalanceFreedSlot(task(1, 1020, 60, []), [
      task(2, 1380, 45, [{ type: "sleep", lostMin: 45 }]),
      task(3, 1290, 30, [{ type: "winddown", lostMin: 30 }]),
      task(4, 1050, 30, [{ type: "routine", lostMin: 30 }]),
    ]);
    expect(result.updates).toEqual([
      { id: 2, startMin: 1020, durationMin: 45, approvedCosts: [] },
      { id: 3, startMin: 1305, durationMin: 15,
        approvedCosts: [{ type: "winddown", lostMin: 15 }] },
    ]);
    expect(result.splits).toEqual([
      { sourceId: 3, startMin: 1065, durationMin: 15, approvedCosts: [] },
    ]);
  });

  it("trades sleep for a lower-priority destination cost but not for an equal cost", () => {
    const routineSlot = task(1, 1020, 30, [{ type: "routine", lostMin: 30, title: "Workout" }]);
    expect(rebalanceFreedSlot(routineSlot, [
      task(2, 1380, 30, [{ type: "sleep", lostMin: 30 }]),
    ])).toEqual({ updates: [
      { id: 2, startMin: 1020, durationMin: 30,
        approvedCosts: [{ type: "routine", lostMin: 30, title: "Workout" }] },
    ], splits: [] });

    expect(rebalanceFreedSlot(task(1, 1020, 30, [{ type: "sleep", lostMin: 30 }]), [
      task(2, 1380, 30, [{ type: "sleep", lostMin: 30 }]),
    ])).toEqual({ updates: [], splits: [] });
  });

  it("leaves the freed slot blank when nothing else is sacrificing time", () => {
    expect(rebalanceFreedSlot(task(1, 1020, 45, []), [
      task(2, 1100, 30, []),
      { ...task(3, 1200, 30, [{ type: "sleep", lostMin: 30 }]), status: "done" },
    ])).toEqual({ updates: [], splits: [] });
  });

  it("preserves the exact total minutes when a sacrificed session is split", () => {
    const source = task(2, 1380, 60, [{ type: "sleep", lostMin: 60 }]);
    const result = rebalanceFreedSlot(task(1, 1020, 20, []), [source]);
    const updated = result.updates.find((item) => item.id === source.id)!;
    expect(updated.durationMin + result.splits.reduce((sum, item) => sum + item.durationMin, 0)).toBe(60);
    expect(updated.approvedCosts).toEqual([{ type: "sleep", lostMin: 40 }]);
  });
});

describe("deletion rebalancing", () => {
  it("reuses a planned occupied slot to restore sacrificed sleep", () => {
    expect(rebalanceAfterDeletion(task(1, 1020, 30, []), [
      task(2, 1380, 30, [{ type: "sleep", lostMin: 30 }]),
    ])).toEqual({ updates: [
      { id: 2, startMin: 1020, durationMin: 30, approvedCosts: [] },
    ], splits: [] });
  });

  it("does not restore time when deleting completed or unplaced work", () => {
    const sacrificed = [task(2, 1380, 30, [{ type: "sleep", lostMin: 30 }])];
    expect(rebalanceAfterDeletion({ ...task(1, 1020, 30, []), status: "done" }, sacrificed))
      .toEqual({ updates: [], splits: [] });
    expect(rebalanceAfterDeletion({ ...task(1, 1020, 30, []), startMin: null }, sacrificed))
      .toEqual({ updates: [], splits: [] });
  });

  it("does not move work backward into a slot that already passed", () => {
    expect(rebalanceAfterDeletion(task(1, 1020, 30, []), [
      task(2, 1380, 30, [{ type: "sleep", lostMin: 30 }]),
    ], 1050)).toEqual({ updates: [], splits: [] });
  });
});
