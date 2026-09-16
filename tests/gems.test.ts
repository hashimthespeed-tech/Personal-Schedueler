import { describe, it, expect } from "vitest";
import { alternate } from "@/agents/gem";
import { gemSeeds, gemKeyForCapture } from "@/data/gems";
import type { CourseLike } from "@/data/capture-targets";

const COURSES: CourseLike[] = [
  { code: "APUSH", name: "AP US History 1", period: 1, domain: "school", teacher: "Mrs. Reyes" },
  { code: "AIDEV", name: "AI Powered Dev 1C", period: 3, domain: "ai", teacher: null },
  { code: "APCALC", name: "AP Calculus AB", period: 4, domain: "school", teacher: "Mr. Tran" },
  { code: "TEAMSP", name: "Team Sports", period: 6, domain: "physique" },
  { code: "FREE", name: "Free Period", period: 7, domain: "school" },
];

describe("gem roster", () => {
  const seeds = gemSeeds(COURSES);
  const keys = seeds.map((s) => s.key);

  it("gives every real class its own gem", () => {
    expect(keys).toContain("subject-apush");
    expect(keys).toContain("subject-aidev");
    expect(keys).toContain("subject-apcalc");
  });

  it("does not make a tutor for a free period or for PE", () => {
    expect(keys).not.toContain("subject-free");
    expect(keys).not.toContain("subject-teamsp");
  });

  it("keeps the four specialists alongside the subjects", () => {
    for (const key of ["school-general", "coach", "ustadh", "ai-projects", "money"]) {
      expect(keys).toContain(key);
    }
  });

  it("names the teacher in the brief when there is one", () => {
    const calc = seeds.find((s) => s.key === "subject-apcalc");
    expect(calc?.instructions).toContain("Mr. Tran");
    const aidev = seeds.find((s) => s.key === "subject-aidev");
    expect(aidev?.instructions).not.toContain("null");
  });

  it("uses keys that are unique, since the key is what sync matches on", () => {
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("routing a phone capture to a gem", () => {
  const keys = new Set(gemSeeds(COURSES).map((s) => s.key));

  it("sends a photographed worksheet to that course's own tutor", () => {
    const key = gemKeyForCapture({ courseCode: "APCALC", agent: "tutor", domain: "school" });
    expect(key).toBe("subject-apcalc");
    expect(keys.has(key)).toBe(true);
  });

  it("sends a meal, a scale photo and a workout to the coach", () => {
    expect(gemKeyForCapture({ agent: "coach", domain: "physique" })).toBe("coach");
  });

  it("splits the builder by domain so money does not land in AI projects", () => {
    expect(gemKeyForCapture({ agent: "builder", domain: "money" })).toBe("money");
    expect(gemKeyForCapture({ agent: "builder", domain: "ai" })).toBe("ai-projects");
  });

  it("falls back to a gem that exists rather than one that does not", () => {
    expect(keys.has(gemKeyForCapture({ agent: "tutor", domain: "school" }))).toBe(true);
  });
});

describe("thread alternation", () => {
  it("leaves an already-alternating thread alone", () => {
    const rows = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
    ];
    expect(alternate(rows)).toEqual(rows);
  });

  it("folds two user turns together when a reply failed after saving", () => {
    const folded = alternate([
      { role: "user", content: "first try" },
      { role: "user", content: "second try" },
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0]?.role).toBe("user");
    expect(folded[0]?.content).toBe("first try\n\nsecond try");
  });

  it("drops a leading assistant turn, which the API rejects", () => {
    const out = alternate([
      { role: "assistant", content: "cut off mid-thread" },
      { role: "user", content: "carry on" },
    ]);
    expect(out).toEqual([{ role: "user", content: "carry on" }]);
  });

  it("never returns two turns of the same role in a row", () => {
    const messy = [
      { role: "assistant", content: "1" },
      { role: "assistant", content: "2" },
      { role: "user", content: "3" },
      { role: "user", content: "4" },
      { role: "assistant", content: "5" },
      { role: "user", content: "6" },
    ];
    const out = alternate(messy);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]?.role).not.toBe(out[i - 1]?.role);
    }
    expect(out[0]?.role).toBe("user");
  });

  it("is empty for an empty thread rather than throwing", () => {
    expect(alternate([])).toEqual([]);
  });
});
