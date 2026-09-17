import { describe, it, expect } from "vitest";
import {
  dayFor, weekFrom, dayTypeFor, coreSlots, trackedSlots,
  overlapsIgnoringPrayer, DEFAULT_ROUTINE, INSERTED_SLOT,
} from "@/core/routine";
import { prayerBlocks } from "@/core/prayer";
import { to12h } from "@/core/types";
import { consistency } from "@/core/consistency";

const MON = "2026-09-14";
const TUE = "2026-09-15";
const FRI = "2026-09-18";
const SAT = "2026-09-19";
const SUN = "2026-09-20";

describe("day types", () => {
  it("knows which day is which", () => {
    expect(dayTypeFor(1)).toBe("school");
    expect(dayTypeFor(2)).toBe("practice");
    expect(dayTypeFor(3)).toBe("school");
    expect(dayTypeFor(4)).toBe("practice");
    expect(dayTypeFor(5)).toBe("school");
    expect(dayTypeFor(6)).toBe("weekend");
    expect(dayTypeFor(7)).toBe("weekend");
  });
});

describe("the four hours", () => {
  it("gives a school day all four", () => {
    const keys = coreSlots(dayFor(MON)).map((s) => s.key);
    expect(keys).toEqual(["islam", "period-7", "train", "school-work", "build"]);
  });

  it("drops the home workout on a practice day — practice is the training", () => {
    const keys = coreSlots(dayFor(TUE)).map((s) => s.key);
    expect(keys).not.toContain("train");
    expect(keys).toContain("practice");
    expect(keys).toContain("islam");
    expect(keys).toContain("school-work");
    expect(keys).toContain("build");
  });

  it("gives a weekend all four with no school period", () => {
    const keys = coreSlots(dayFor(SAT)).map((s) => s.key);
    expect(keys).toEqual(["islam", "build", "train", "school-work"]);
  });

  it("makes every core hour exactly an hour", () => {
    for (const date of [MON, TUE, SAT]) {
      for (const slot of coreSlots(dayFor(date))) {
        if (slot.key === "period-7") continue; // 50 min, set by the bell
        if (slot.key === "practice") continue; // ends when the coach says
        expect(slot.end - slot.start).toBe(60);
      }
    }
  });
});

describe("the morning is identical on every school day", () => {
  it("runs the same slots at the same times Mon through Fri", () => {
    const shape = (date: string) =>
      dayFor(date)
        .slots.filter((s) => s.start < DEFAULT_ROUTINE.leaveHome && s.end > 0)
        .map((s) => `${s.key}@${s.start}`);

    const monday = shape(MON);
    expect(shape("2026-09-15")).toEqual(monday);
    expect(shape("2026-09-16")).toEqual(monday);
    expect(shape("2026-09-17")).toEqual(monday);
  });

  it("uses Friday's later start without moving the blocks", () => {
    const fri = dayFor(FRI);
    const mon = dayFor(MON);
    const islamFri = fri.slots.find((s) => s.key === "islam")!;
    const islamMon = mon.slots.find((s) => s.key === "islam")!;
    expect(islamFri.start).toBe(islamMon.start);

    // the extra half hour becomes slack, not a longer scramble for the door
    const outFri = fri.slots.find((s) => s.key === "leave")!;
    const outMon = mon.slots.find((s) => s.key === "leave")!;
    expect(outFri.end - outFri.start).toBe(outMon.end - outMon.start);
    expect(fri.slots.find((s) => s.key === "slow-start")).toBeDefined();
    expect(mon.slots.find((s) => s.key === "slow-start")).toBeUndefined();
  });

  it("spends all 125 minutes and leaves none spare", () => {
    const day = dayFor(MON);
    const morning = day.slots.filter((s) => s.end <= DEFAULT_ROUTINE.leaveHome && s.end > s.start);
    const used = morning.reduce((n, s) => n + (s.end - s.start), 0);
    expect(used).toBe(DEFAULT_ROUTINE.leaveHome - DEFAULT_ROUTINE.wake);
    expect(used).toBe(125);
  });
});

describe("nothing overlaps and nothing gaps", () => {
  it("has no two solid slots on top of each other, any day of the week", () => {
    for (const day of weekFrom(MON)) {
      expect(overlapsIgnoringPrayer(day)).toEqual([]);
    }
  });

  it("never runs past lights out", () => {
    for (const day of weekFrom(MON)) {
      for (const slot of day.slots) {
        expect(slot.end).toBeLessThanOrEqual(day.lightsOut);
      }
    }
  });

  it("never starts before he is up", () => {
    for (const day of weekFrom(MON)) {
      for (const slot of day.slots) {
        expect(slot.start).toBeGreaterThanOrEqual(day.wake);
      }
    }
  });
});

describe("the day is actually livable", () => {
  it("puts a shower after every workout", () => {
    for (const date of [MON, SAT]) {
      const slots = dayFor(date).slots;
      const train = slots.find((s) => s.key === "train")!;
      const shower = slots.find((s) => s.key === "shower")!;
      expect(shower.start).toBeGreaterThanOrEqual(train.end);
    }
  });

  it("showers on a practice day too, since practice is the workout", () => {
    const slots = dayFor(TUE).slots;
    expect(slots.find((s) => s.key === "shower")).toBeDefined();
  });

  it("never puts school work first thing after waking", () => {
    for (const day of weekFrom(MON)) {
      const school = day.slots.filter((s) => s.key.startsWith("school-work"));
      for (const slot of school) {
        expect(slot.start).toBeGreaterThan(day.wake + 120);
      }
    }
  });

  it("never puts school work straight off the bus, when his brain is fried", () => {
    for (const date of [MON, FRI]) {
      const day = dayFor(date);
      const school = day.slots.find((s) => s.key === "school-work")!;
      // home at 3:55 — nothing demanding for at least an hour
      expect(school.start).toBeGreaterThanOrEqual(DEFAULT_ROUTINE.homeFromSchool + 60);
    }
  });

  it("feeds him before the evening work, not after it", () => {
    const slots = dayFor(MON).slots;
    const meal = slots.find((s) => s.key === "post-school-meal")!;
    const work = slots.find((s) => s.key === "school-work")!;
    expect(meal.end).toBeLessThanOrEqual(work.start);
  });

  it("leaves real free time before wind-down on a school day", () => {
    const free = dayFor(MON).slots.find((s) => s.key === "free");
    expect(free).toBeDefined();
    expect(free!.end - free!.start).toBeGreaterThanOrEqual(45);
  });

  it("clears the whole weekend afternoon", () => {
    const sat = dayFor(SAT);
    const lastCore = coreSlots(sat).reduce((a, b) => (a.end > b.end ? a : b));
    expect(lastCore.end).toBeLessThanOrEqual(12 * 60 + 30);
  });
});

describe("sleep", () => {
  it("gives eight hours on a school night", () => {
    const day = dayFor(MON);
    expect(day.wake).toBe(6 * 60);
    expect(day.lightsOut).toBe(22 * 60);
    expect((day.wake + 1440 - day.lightsOut) % 1440).toBe(8 * 60);
  });

  it("drifts the weekend by thirty minutes, not three hours", () => {
    const sat = dayFor(SAT);
    expect(sat.wake - dayFor(MON).wake).toBe(30);
    expect((sat.wake + 1440 - sat.lightsOut) % 1440).toBe(8 * 60);
  });
});

describe("prayer", () => {
  it("puts Fajr at the wake time, because 6:00 is inside the window", () => {
    for (const day of weekFrom(MON)) {
      const fajr = day.slots.find((s) => s.key === "fajr")!;
      expect(fajr.start).toBe(day.wake);

      const real = prayerBlocks(day.date).find((b) => b.name === "fajr")!;
      expect(day.wake).toBeGreaterThanOrEqual(real.start);
      expect(day.wake).toBeLessThan(real.window.end);
    }
  });

  it("puts Maghrib at its real time, which moves all year", () => {
    for (const date of ["2026-09-14", "2026-12-15", "2027-06-10"]) {
      const day = dayFor(date);
      const slot = day.slots.find((s) => s.key === "maghrib-isha")!;
      const real = prayerBlocks(date).find((b) => b.name === "maghrib-isha")!;
      expect(slot.start).toBe(Math.min(real.start, day.lightsOut - 20));
    }
  });

  it("moves Maghrib by more than three hours across the year", () => {
    const dec = dayFor("2026-12-05").slots.find((s) => s.key === "maghrib-isha")!;
    const jun = dayFor("2027-06-20").slots.find((s) => s.key === "maghrib-isha")!;
    expect(jun.start - dec.start).toBeGreaterThan(180);
  });

  it("has Dhuhr + Asr covered at school and scheduled at the weekend", () => {
    const school = dayFor(MON);
    const p7 = school.slots.find((s) => s.key === "period-7")!;
    const window = prayerBlocks(MON).find((b) => b.name === "dhuhr-asr")!;
    expect(p7.start).toBeGreaterThanOrEqual(window.start);
    expect(p7.end).toBeLessThanOrEqual(window.window.end);

    expect(dayFor(SUN).slots.find((s) => s.key === "dhuhr-asr")).toBeDefined();
  });
});

describe("the extra school hour", () => {
  it("adds one hour and only when asked", () => {
    const plain = coreSlots(dayFor(MON)).length;
    const extra = coreSlots(dayFor(MON, { extraSchoolHour: true }));
    expect(extra.length).toBe(plain + 1);
    expect(extra.some((s) => s.key === "school-work-extra")).toBe(true);
  });

  it("still finishes before lights out", () => {
    const day = dayFor(MON, { extraSchoolHour: true });
    for (const slot of day.slots) expect(slot.end).toBeLessThanOrEqual(day.lightsOut);
  });
});

describe("what gets scored", () => {
  it("scores the four hours and the three prayers, and nothing else", () => {
    const tracked = trackedSlots(dayFor(MON)).map((s) => s.key).sort();
    expect(tracked).toEqual(
      ["build", "fajr", "islam", "maghrib-isha", "period-7", "school-work", "train"].sort(),
    );
  });

  it("never scores eating, showering or free time", () => {
    for (const day of weekFrom(MON)) {
      for (const slot of day.slots) {
        if (["breakfast", "dinner", "shower", "free", "wind-down", "school", "leave"].includes(slot.key)) {
          expect(slot.tracked).toBe(false);
        }
      }
    }
  });
});

describe("the week is the same week every week", () => {
  it("produces an identical shape seven days later", () => {
    const shape = (d: string) => dayFor(d).slots.filter((s) => s.key !== INSERTED_SLOT).map((s) => `${s.key}@${s.start}-${s.end}`);
    expect(shape("2026-09-21")).toEqual(shape(MON));
    expect(shape("2026-09-26")).toEqual(shape(SAT));
  });
});


describe("no unexplained holes in the day", () => {
  it("accounts for every waking minute from wake to lights out", () => {
    for (const day of weekFrom(MON)) {
      const solid = day.slots
        .filter((s) => s.key !== INSERTED_SLOT && s.end > s.start)
        .sort((a, b) => a.start - b.start);

      let cursor = day.wake;
      for (const slot of solid) {
        expect(slot.start).toBe(cursor);
        cursor = slot.end;
      }
      expect(cursor).toBe(day.lightsOut);
    }
  });

  it("shows practice on a practice day rather than leaving a two-hour hole", () => {
    const practice = dayFor(TUE).slots.find((s) => s.key === "practice")!;
    expect(practice).toBeDefined();
    expect(practice.end).toBe(DEFAULT_ROUTINE.homeFromPractice);
    expect(practice.end - practice.start).toBeGreaterThan(90);
  });
});

describe("consistency", () => {
  const rows = (entries: [string, string, "done" | "missed"][]) =>
    entries.map(([onDate, slotKey, status]) => ({ onDate, slotKey, status }));

  it("does not count days before he ever used it", () => {
    // asking for a fortnight on day two used to report 8% and mean nothing
    const score = consistency("2026-09-08", "2026-09-21", rows([
      ["2026-09-21", "islam", "done"],
      ["2026-09-21", "period-7", "done"],
      ["2026-09-21", "train", "done"],
      ["2026-09-21", "school-work", "done"],
      ["2026-09-21", "build", "done"],
    ]));

    expect(score.from).toBe("2026-09-21");
    expect(score.days).toBe(1);
    expect(score.core).toBe(1);
  });

  it("counts a day he answered nothing as a gap, not as a pass", () => {
    const score = consistency("2026-09-21", "2026-09-22", rows([
      ["2026-09-21", "islam", "done"],
    ]));

    const islam = score.slots.find((s) => s.key === "islam")!;
    expect(islam.scheduled).toBe(2);
    expect(islam.done).toBe(1);
    expect(islam.silent).toBe(1);
    expect(islam.rate).toBe(0.5);
  });

  it("separates a cross from a silence", () => {
    const score = consistency("2026-09-21", "2026-09-21", rows([
      ["2026-09-21", "islam", "missed"],
    ]));

    const islam = score.slots.find((s) => s.key === "islam")!;
    expect(islam.missed).toBe(1);
    expect(islam.silent).toBe(0);
  });

  it("counts a streak only when every core hour that day was done", () => {
    const full = (d: string): [string, string, "done"][] =>
      (["islam", "period-7", "train", "school-work", "build"] as const).map((k) => [d, k, "done"]);

    const score = consistency("2026-09-21", "2026-09-23", rows([
      ...full("2026-09-21"),
      ["2026-09-22", "islam", "done"],
      ...full("2026-09-23"),
    ]));

    // Tuesday was partial, so the run resets and only Wednesday is current
    expect(score.currentStreak).toBe(1);
    expect(score.bestStreak).toBe(1);
  });
});
