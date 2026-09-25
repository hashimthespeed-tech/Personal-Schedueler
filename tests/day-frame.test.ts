import { describe, expect, it } from "vitest";
import { buildDayFrame } from "../src/core/day-frame";

describe("day frames from the real weekly schedule", () => {
  it("protects school and reserves friend time in period seven on a regular day", () => {
    const day = buildDayFrame("2026-09-21", { sleepMode: "current" });
    expect(day).toMatchObject({ wake: 360, workCutoff: 1260, bedtime: 1320, emergencyEnd: 1365, nextWake: 360 });
    expect(day.blocks.find((block) => block.id === "1-p1")).toMatchObject({ start: 510, end: 560, policy: "fixed" });
    expect(day.blocks.find((block) => block.id === "1-p7")).toMatchObject({
      start: 886, end: 936, policy: "flexible", cost: "friend", canUseFor: "school",
    });
    expect(day.blocks.find((block) => block.id === "morning-prep")).toMatchObject({
      start: 460, end: 485, policy: "protected",
    });
    expect(day.blocks.find((block) => block.id === "arrival-buffer")).toMatchObject({
      start: 955, end: 985, policy: "protected",
    });
    expect(day.blocks.find((block) => block.id === "recurring-dhuhr-asr")).toMatchObject({
      start: 985, end: 997, policy: "protected",
    });
    expect(day.blocks.find((block) => block.id === "recurring-workout")).toMatchObject({
      start: 1050, end: 1080, policy: "flexible", minMinutes: 0, cost: "routine",
    });
  });

  it("moves the protected arrival window after wrestling on Tuesday and Thursday", () => {
    for (const date of ["2026-09-22", "2026-09-24"]) {
      const day = buildDayFrame(date, { sleepMode: "current" });
      expect(day.blocks.find((block) => block.id === "recurring-wrestling")).toMatchObject({ start: 936, end: 1050 });
      expect(day.blocks.find((block) => block.id === "arrival-buffer")).toMatchObject({ start: 1050, end: 1095 });
      expect(day.blocks.find((block) => block.id === "recurring-dhuhr-asr")?.start).toBe(1095);
    }
  });

  it("can expose explicit routine trade-offs without making them free time", () => {
    const monday = buildDayFrame("2026-09-21", { sleepMode: "current", includeRoutineTradeoffs: true });
    expect(monday.blocks.find((block) => block.id === "personal-focus")).toMatchObject({
      policy: "flexible", minMinutes: 40, cost: "routine",
    });
    expect(monday.blocks.find((block) => block.id === "wind-down")).toMatchObject({
      start: 1260, end: 1320, policy: "flexible", minMinutes: 0, cost: "winddown",
    });

    const practice = buildDayFrame("2026-09-22", { sleepMode: "current", includeRoutineTradeoffs: true });
    expect(practice.blocks.some((block) => block.id === "recurring-workout")).toBe(false);
  });

  it("uses the Friday bells and supports the future sleep schedule", () => {
    const day = buildDayFrame("2026-09-25", { sleepMode: "target" });
    expect(day).toMatchObject({ wake: 360, bedtime: 1320, nextWake: 360 });
    expect(day.blocks.find((block) => block.id === "5-p1")).toMatchObject({ start: 540, end: 582 });
    expect(day.blocks.find((block) => block.id === "arrival-buffer")).toMatchObject({ start: 949, end: 979 });
    expect(day.blocks.find((block) => block.id === "recurring-dhuhr-asr")?.start).toBe(979);
  });

  it("keeps weekends open apart from recurring and user-provided commitments", () => {
    const day = buildDayFrame("2026-09-26", { sleepMode: "current", extraBlocks: [
      { id: "appointment", title: "Appointment", start: 720, end: 780, policy: "fixed" },
    ] });
    expect(day.blocks.find((block) => block.id === "appointment")).toBeDefined();
    expect(day.blocks.find((block) => block.id === "recurring-workout")).toMatchObject({ start: 1050, end: 1080 });
    expect(day.blocks.filter((block) => block.id.startsWith("recurring-") && block.title.includes("Prayer"))).toHaveLength(0);
  });

  it("does not repeat the old school term indefinitely", () => {
    const day = buildDayFrame("2026-12-21", { sleepMode: "current" });
    expect(day.blocks.some((block) => block.id.startsWith("1-p"))).toBe(false);
    expect(day.blocks.find((block) => block.id === "recurring-workout")).toBeDefined();
  });

  it("rests on Wednesday and always protects the 9 PM phone-off hour", () => {
    const day = buildDayFrame("2026-09-23", { sleepMode: "current" });
    expect(day.blocks.some((block) => block.id === "recurring-workout")).toBe(false);
    expect(day.blocks.find((block) => block.id === "wind-down")).toMatchObject({
      start: 1260, end: 1320, policy: "flexible", cost: "winddown",
    });
  });
});
