/**
 * The gem roster.
 *
 * One per subject rather than one tutor for all five: a single thread across
 * five AP courses means every question arrives carrying four subjects of
 * irrelevant history, and nothing ever accumulates into knowing how he does
 * calculus specifically.
 */

import type { CourseLike } from "./capture-targets";

export interface GemSeed {
  key: string;
  label: string;
  blurb: string;
  category: string;
  domain: string;
  agent: string;
  courseCode?: string;
  instructions: string;
  sortOrder: number;
}

const SUBJECT_INSTRUCTIONS = (name: string, teacher: string | null) => `
You are his tutor for ${name}${teacher ? `, taught by ${teacher}` : ""}, and only
that course. Questions about other subjects belong to their own gem — say so
and move on rather than answering across two courses in one thread.

Teach rather than answer. Work a problem with him, ask what he has tried, let
him get it wrong and then say why it is wrong. Handing over a finished solution
is the fastest way to make him worse at this.

Remember what keeps tripping him up in this course specifically. That is what
makes you worth more than a fresh chat window.
`.trim();

export function gemSeeds(courses: CourseLike[]): GemSeed[] {
  const academic = courses
    .filter((c) => c.domain === "school" || c.domain === "ai")
    .filter((c) => c.code !== "FREE")
    .sort((a, b) => a.period - b.period);

  const subjects = academic.map<GemSeed>((c, i) => ({
    key: `subject-${c.code.toLowerCase()}`,
    label: c.name,
    blurb: `Period ${c.period}`,
    category: "School",
    domain: c.domain,
    agent: "tutor",
    courseCode: c.code,
    instructions: SUBJECT_INSTRUCTIONS(c.name, c.teacher ?? null),
    sortOrder: i,
  }));

  return [
    ...subjects,
    {
      key: "school-general",
      label: "School — general",
      blurb: "Workload, planning, anything across courses",
      category: "School",
      domain: "school",
      agent: "tutor",
      instructions: `
Everything about school that is not one specific course: how the week is
shaped, what to do when four things are due at once, whether to drop
something. Send single-subject questions to that subject's gem.
`.trim(),
      sortOrder: 90,
    },
    {
      key: "coach",
      label: "Coach",
      blurb: "Training, eating, recovery",
      category: "Fitness",
      domain: "physique",
      agent: "coach",
      instructions: `
Keep the training log in your memory: what he lifted, what he is stuck on,
where the plate ceiling is biting. A new chat should not need him to repeat
last month.
`.trim(),
      sortOrder: 0,
    },
    {
      key: "ustadh",
      label: "Ustadh",
      blurb: "Salah, Quran, Islamic study",
      category: "Islam",
      domain: "deen",
      agent: "ustadh",
      instructions: `
Remember where he is in the Quran and what he has asked about before, so a
new conversation continues rather than restarts.
`.trim(),
      sortOrder: 0,
    },
    {
      key: "ai-projects",
      label: "AI projects",
      blurb: "Building and shipping",
      category: "Projects",
      domain: "ai",
      agent: "builder",
      instructions: `
Keep the state of each project in memory — what exists, what is half-built,
what was abandoned. Ask what shipped since last time before planning anything
new.
`.trim(),
      sortOrder: 0,
    },
    {
      key: "money",
      label: "Money",
      blurb: "Making money with what he builds",
      category: "Projects",
      domain: "money",
      agent: "builder",
      instructions: `
Push toward one concrete thing someone would pay for. Remember what has been
tried and what it earned, so the same idea does not get re-planned every month.
`.trim(),
      sortOrder: 1,
    },
  ];
}

export const GEM_CATEGORIES = ["School", "Fitness", "Islam", "Projects"] as const;

/**
 * Which gem a phone capture belongs to.
 *
 * A photographed worksheet should land in that course's thread, not in a
 * generic inbox — the tutor that later gets asked about it is the one that
 * needs to already have seen it.
 */
export function gemKeyForCapture(target: {
  courseCode?: string;
  agent: string;
  domain: string;
}): string {
  if (target.courseCode) return `subject-${target.courseCode.toLowerCase()}`;
  if (target.agent === "coach") return "coach";
  if (target.agent === "ustadh") return "ustadh";
  if (target.agent === "builder") return target.domain === "money" ? "money" : "ai-projects";
  return "school-general";
}
