import { describe, it, expect } from "vitest";
import { alternate } from "@/agents/gem";
import { planStartFor } from "@/agents/planner";
import { titleStem } from "@/agents/task-writer";
import { slugify } from "@/agents/tools";
import { gemSeeds, gemKeyForCapture } from "@/data/gems";
import { ACCEPTED, MAX_FILES, MAX_PDF_BYTES, MAX_TOTAL_BASE64, describeSize, isImage } from "@/lib/attachments";
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

describe("threads that carry files", () => {
  it("keeps image blocks intact when folding two user turns together", () => {
    const out = alternate([
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "AAAA" } },
          { type: "text", text: "what is this asking" },
        ],
      },
      { role: "user", content: "sorry, this one" },
    ]);

    expect(out).toHaveLength(1);
    const blocks = out[0]?.content;
    expect(Array.isArray(blocks)).toBe(true);
    expect((blocks as unknown[]).length).toBe(3);
    expect((blocks as { type: string }[])[0]?.type).toBe("image");
  });

  it("promotes a text turn to blocks rather than dropping the file next to it", () => {
    const out = alternate([
      { role: "user", content: "here" },
      {
        role: "user",
        content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: "AAAA" } }],
      },
    ]);

    const blocks = out[0]?.content as { type: string }[];
    expect(blocks.map((b) => b.type)).toEqual(["text", "document"]);
  });
});

describe("attachment limits", () => {
  it("takes the formats a phone and a teacher actually produce", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"]) {
      expect(ACCEPTED.includes(type)).toBe(true);
    }
  });

  it("refuses what the model cannot read", () => {
    for (const type of ["video/mp4", "text/csv", "application/zip", ""]) {
      expect(ACCEPTED.includes(type)).toBe(false);
    }
  });

  it("calls only images images, so a PDF is never sent as an image block", () => {
    expect(isImage("image/png")).toBe(true);
    expect(isImage("application/pdf")).toBe(false);
  });

  it("stays inside the 4.5 MB request body the host allows", () => {
    // base64 is 4/3 of the bytes, and the JSON around it is not free
    expect(MAX_TOTAL_BASE64).toBeLessThan(4_500_000);
    expect(MAX_FILES * MAX_PDF_BYTES * 1.34).toBeGreaterThan(MAX_TOTAL_BASE64);
  });

  it("describes a size the way a person would say it", () => {
    expect(describeSize(900)).toBe("900 B");
    expect(describeSize(2048)).toBe("2 KB");
    expect(describeSize(3_500_000)).toBe("3.3 MB");
  });
});

describe("what week the planner is planning", () => {
  it("plans from today when asked mid-week, not from a Monday already spent", () => {
    // Wednesday: "week of Monday the 14th" names two days already lived
    expect(planStartFor("2026-09-16")).toBe("2026-09-16");
    expect(planStartFor("2026-09-14")).toBe("2026-09-14");
    expect(planStartFor("2026-09-18")).toBe("2026-09-18");
  });

  it("rolls to Monday when asked at the weekend, which is the week he means", () => {
    expect(planStartFor("2026-09-19")).toBe("2026-09-21");
    expect(planStartFor("2026-09-20")).toBe("2026-09-21");
  });
});

describe("task identity", () => {
  it("reduces wording differences that are genuinely the same title", () => {
    expect(titleStem("Morning weigh-in")).toBe(titleStem("morning weigh in"));
    expect(titleStem("Food shop + batch cook")).toBe(titleStem("Food shop  batch cook"));
  });

  it("never collapses two different sessions into one", () => {
    // silently overwriting Lift B with Lift A is worse than showing both
    expect(titleStem("Lift A - full body")).not.toBe(titleStem("Lift B - full body"));
    expect(titleStem("Lift A - full body")).not.toBe(titleStem("Lift A — squat / bench / row"));
    expect(titleStem("APUSH ch. 12")).not.toBe(titleStem("APUSH ch. 13"));
  });
});

describe("task keys arrive however the model writes them", () => {
  it("normalizes the shapes a model actually produces", () => {
    expect(slugify("Lift A")).toBe("lift-a");
    expect(slugify("lift_a")).toBe("lift-a");
    expect(slugify("liftA")).toBe("lift-a");
    expect(slugify("  Morning Weigh-In  ")).toBe("morning-weigh-in");
    expect(slugify("APUSH ch. 12")).toBe("apush-ch-12");
  });

  it("keeps different work under different keys", () => {
    expect(slugify("Lift A")).not.toBe(slugify("Lift B"));
  });

  it("never returns an empty key, which would collide with every other one", () => {
    expect(slugify("!!!")).toBe("task");
    expect(slugify("   ")).toBe("task");
  });

  it("does not leave a trailing hyphen after truncating a long key", () => {
    const long = slugify(`${"word ".repeat(40)}`);
    expect(long.endsWith("-")).toBe(false);
    expect(long.length).toBeLessThanOrEqual(60);
  });
});
