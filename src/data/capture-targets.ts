/**
 * What a photo can be about.
 *
 * Two levels: a category, then the specific thing. The second level is what
 * makes the photo useful — "school" tells the model almost nothing, "AP
 * Calculus AB" tells it which course, which teacher, and what the homework
 * usually looks like. Guessing the subject from a photo of a worksheet is
 * exactly the kind of guess that produces a task that is quietly wrong.
 */

import type { Domain } from "@/core/types";
import type { SpecialistName } from "@/agents/specialists";

/** What the photo should turn into. */
export type CaptureKind =
  | "homework"
  | "syllabus"
  | "meal"
  | "bodyweight"
  | "workout"
  | "note";

export interface CaptureTarget {
  id: string;
  label: string;
  /** shown under the label when the choice needs explaining */
  hint?: string;
  agent: SpecialistName;
  domain: Domain;
  kind: CaptureKind;
  /** course code, when this target is a specific class */
  courseCode?: string;
  /** which meal, for food photos */
  mealSlot?: string;
}

export interface CaptureCategory {
  id: string;
  label: string;
  domain: Domain;
  targets: CaptureTarget[];
}

export interface CourseLike {
  code: string;
  name: string;
  period: number;
  domain: string;
}

/** Meals named as the training plan names them, so a log lines up with it. */
const MEALS: { id: string; label: string; hint: string }[] = [
  { id: "breakfast", label: "Breakfast", hint: "Before school" },
  { id: "lunch", label: "School lunch", hint: "What you packed" },
  { id: "after-school", label: "After school", hint: "The two plates" },
  { id: "dinner", label: "Dinner", hint: "" },
  { id: "before-bed", label: "Before bed", hint: "" },
  { id: "snack", label: "Snack", hint: "Anything else" },
];

/**
 * Build the picker. Subjects come from the courses table rather than a second
 * hardcoded list, so changing a schedule in one place changes it everywhere.
 */
export function captureCategories(courses: CourseLike[]): CaptureCategory[] {
  const academic = courses
    .filter((c) => c.domain === "school" || c.domain === "ai")
    .filter((c) => c.code !== "FREE")
    .sort((a, b) => a.period - b.period);

  const school: CaptureCategory = {
    id: "school",
    label: "School",
    domain: "school",
    targets: [
      ...academic.map<CaptureTarget>((c) => ({
        id: `course-${c.code}`,
        label: c.name,
        hint: `Period ${c.period}`,
        agent: "tutor",
        domain: c.domain === "ai" ? "ai" : "school",
        kind: "homework",
        courseCode: c.code,
      })),
      {
        id: "school-general",
        label: "General",
        hint: "Anything not tied to one class",
        agent: "tutor",
        domain: "school",
        kind: "homework",
      },
      {
        id: "school-syllabus",
        label: "Syllabus or calendar",
        hint: "Several dates at once",
        agent: "tutor",
        domain: "school",
        kind: "syllabus",
      },
    ],
  };

  const fitness: CaptureCategory = {
    id: "physique",
    label: "Fitness",
    domain: "physique",
    targets: [
      ...MEALS.map<CaptureTarget>((m) => ({
        id: `meal-${m.id}`,
        label: m.label,
        hint: m.hint || undefined,
        agent: "coach",
        domain: "physique",
        kind: "meal",
        mealSlot: m.id,
      })),
      {
        id: "bodyweight",
        label: "Weigh-in",
        hint: "Photo of the scale",
        agent: "coach",
        domain: "physique",
        kind: "bodyweight",
      },
      {
        id: "workout-log",
        label: "Workout log",
        hint: "Your written sets",
        agent: "coach",
        domain: "physique",
        kind: "workout",
      },
      {
        id: "physique-other",
        label: "Other",
        agent: "coach",
        domain: "physique",
        kind: "note",
      },
    ],
  };

  const deen: CaptureCategory = {
    id: "deen",
    label: "Deen",
    domain: "deen",
    targets: [
      { id: "deen-quran", label: "Quran", hint: "Where you got to", agent: "ustadh", domain: "deen", kind: "note" },
      { id: "deen-study", label: "Study", hint: "A page or a passage", agent: "ustadh", domain: "deen", kind: "homework" },
      { id: "deen-other", label: "Other", agent: "ustadh", domain: "deen", kind: "note" },
    ],
  };

  const projects: CaptureCategory = {
    id: "projects",
    label: "Projects",
    domain: "ai",
    targets: [
      { id: "ai-project", label: "AI project", hint: "A screen, a sketch, a bug", agent: "builder", domain: "ai", kind: "note" },
      { id: "money-idea", label: "Money", hint: "An idea or something to chase", agent: "builder", domain: "money", kind: "note" },
      { id: "projects-other", label: "Other", agent: "builder", domain: "ai", kind: "note" },
    ],
  };

  return [school, fitness, deen, projects];
}

export function findTarget(categories: CaptureCategory[], id: string): CaptureTarget | null {
  for (const c of categories) {
    const hit = c.targets.find((t) => t.id === id);
    if (hit) return hit;
  }
  return null;
}
