import { describe, expect, it } from "vitest";
import { buildDayFrame } from "../src/core/day-frame";

describe("day frames from the real weekly schedule", () => {
  it("protects school and reserves friend time in period seven on a regular day", () => {
    const day = buildDayFrame("2026-09-21", { sleepMode: "current" });
    expect(day).toMatchObject({ wake: 450, bedtime: 1410, nextWake: 450 });
    expect(day.blocks.find((block) => block.id === "1-p1")).toMatchObject({ start: 510, end: 560, policy: "fixed" });
    expect(day.blocks.find((block) => block.id === "1-p7")).toMatchObject({
      start: 886, end: 936, policy: "flexible", cost: "friend", canUseFor: "school",
    });
    expect(day.blocks.find((block) => block.id === "after-school-prayer")).toMatchObject({
      start: 955, end: 1000, policy: "protected",
    });
  });

  it("moves the protected arrival window after wrestling on Tuesday and Thursday", () => {
    for (const date of ["2026-09-22", "2026-09-24"]) {
      const day = buildDayFrame(date, { sleepMode: "current" });
      expect(day.blocks.some((block) => block.title === "Practice" && block.end === 1050)).toBe(true);
      expect(day.blocks.find((block) => block.id === "after-school-prayer")?.start).toBe(1050);
    }
  });

  it("uses the Friday bells and supports the future sleep schedule", () => {
    const day = buildDayFrame("2026-09-25", { sleepMode: "target" });
    expect(day).toMatchObject({ wake: 360, bedtime: 1320, nextWake: 360 });
    expect(day.blocks.find((block) => block.id === "5-p1")).toMatchObject({ start: 540, end: 582 });
    expect(day.blocks.find((block) => block.id === "after-school-prayer")?.start).toBe(949);
  });

  it("keeps weekends open apart from sleep and user-provided commitments", () => {
    const day = buildDayFrame("2026-09-26", { sleepMode: "current", extraBlocks: [
      { id: "appointment", title: "Appointment", start: 720, end: 780, policy: "fixed" },
    ] });
    expect(day.blocks).toEqual([{ id: "appointment", title: "Appointment", start: 720, end: 780, policy: "fixed" }]);
  });

  it("does not repeat the old school term indefinitely", () => {
    const day = buildDayFrame("2026-12-21", { sleepMode: "current" });
    expect(day.blocks).toEqual([]);
  });
});
