import { describe, it, expect } from "vitest";
import { buildTimeline, netSleepFrom } from "../src/core/timeline";
import { hm, to12h } from "../src/core/types";

const TUE = "2026-09-15";

function build(blocks: Parameters<typeof buildTimeline>[0]["blocks"] = []) {
  return buildTimeline({ date: TUE, weekday: 2, blocks });
}

describe("day timeline", () => {
  // Fajr comes before waking: he prays and goes back to sleep. Putting the
  // wake anchor first would state the day in the wrong order.
  it("opens with Fajr, then the wake anchor", () => {
    const [first, second] = build();
    expect(first?.label).toBe("Fajr");
    expect(second?.label).toBe("Wake up");
    expect(second?.kind).toBe("anchor");
  });

  it("closes with sleep", () => {
    const items = build();
    const last = items[items.length - 1];
    expect(last?.label).toBe("Sleep");
    expect(last?.kind).toBe("anchor");
  });

  it("is ordered by time throughout", () => {
    const items = build([
      { id: 1, title: "Lift", domain: "physique", startMin: hm("18:00"), endMin: hm("18:50"), completed: null, chunkIndex: null, chunkCount: null },
    ]);
    for (let i = 1; i < items.length; i++) {
      expect(items[i]?.start ?? 0, `${items[i]?.label} after ${items[i - 1]?.label}`).toBeGreaterThanOrEqual(items[i - 1]?.start ?? 0);
    }
  });

  // A day of identical tickable boxes makes waking up look like an
  // achievement and a lesson look optional.
  it("marks anchors and classes as not completable, prayer and work as completable", () => {
    const items = build([
      { id: 1, title: "Lift", domain: "physique", startMin: hm("18:00"), endMin: hm("18:50"), completed: null, chunkIndex: null, chunkCount: null },
    ]);
    const wake = items.find((i) => i.label === "Wake up");
    const lesson = items.find((i) => i.label.startsWith("P1 "));
    const prayer = items.find((i) => i.label === "Dhuhr + Asr");
    const task = items.find((i) => i.kind === "task");

    expect(wake?.kind).toBe("anchor");
    expect(lesson?.completable).toBe(false);
    expect(prayer?.completable).toBe(true);
    expect(task?.completable).toBe(true);
  });

  it("carries all three prayer blocks every day", () => {
    const names = build().filter((i) => i.ref?.match(/fajr|dhuhr-asr|maghrib-isha/)).map((i) => i.label);
    expect(names).toEqual(["Fajr", "Dhuhr + Asr", "Maghrib + Isha"]);
  });

  it("keeps practice on a Tuesday and drops commute noise", () => {
    const items = build();
    expect(items.some((i) => i.label === "Practice")).toBe(true);
    expect(items.some((i) => i.label.includes("Commute"))).toBe(false);
  });

  it("has nothing fixed on a weekend but keeps the anchors and prayers", () => {
    const sat = buildTimeline({ date: "2026-09-19", weekday: 6, blocks: [] });
    expect(sat.some((i) => i.label.startsWith("P1 "))).toBe(false);
    expect(sat.filter((i) => i.kind === "anchor")).toHaveLength(2);
    expect(sat.filter((i) => i.ref?.match(/fajr|dhuhr-asr|maghrib-isha/))).toHaveLength(3);
  });
});

describe("net sleep from a reported night", () => {
  // Bedtime is the evening before, so the span crosses midnight.
  it("wraps midnight", () => {
    expect(netSleepFrom(hm("23:00"), hm("06:30"), 0)).toBe(450);
    expect(netSleepFrom(hm("22:00"), hm("06:00"), 0)).toBe(480);
  });

  it("subtracts the Fajr wake", () => {
    expect(netSleepFrom(hm("23:00"), hm("06:30"), 20)).toBe(430);
  });

  it("handles a bedtime after midnight", () => {
    expect(netSleepFrom(hm("01:00"), hm("07:00"), 0)).toBe(360);
  });

  it("never goes negative", () => {
    expect(netSleepFrom(hm("06:00"), hm("06:10"), 60)).toBe(0);
  });

  it("matches what the card would show", () => {
    // 11pm to 6:30am minus a 20 minute Fajr is 7.2 hours
    expect((netSleepFrom(hm("23:00"), hm("06:30"), 20) / 60).toFixed(1)).toBe("7.2");
    void to12h;
  });
});
