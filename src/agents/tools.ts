/**
 * The tools every specialist shares.
 *
 * Deliberately narrow. Specialists describe work and its constraints; they
 * never place it in time and never compute load. Anything a specialist could
 * get arithmetically wrong belongs in src/core or src/coach instead.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { DOMAINS } from "../db/schema";

/**
 * Keys arrive however the model felt like writing them — "Lift A", "lift_a",
 * "liftA". Rejecting those costs a whole turn to a validation error, and with
 * two turns to work with, one wasted turn is the difference between a week
 * being planned and nothing happening. So normalize rather than refuse.
 */
export function slugify(raw: string): string {
  const slug = raw
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "task";
}

export const logAssignmentInput = z.object({
  title: z.string().min(1).max(200),
  kind: z.enum(["homework", "test", "project", "reading"]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  estimatedMin: z.number().int().min(5).max(600),
  notes: z.string().nullable().optional(),
});

export type LogAssignmentInput = z.infer<typeof logAssignmentInput>;

export const logMetricInput = z.object({
  kind: z.string().min(1),
  value: z.number(),
  unit: z.string().nullable().optional(),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export type LogMetricInput = z.infer<typeof logMetricInput>;


export const LOG_ASSIGNMENT: Anthropic.Tool = {
  name: "log_assignment",
  description:
    "Record something that is due — a worksheet, a test, a project. You are NOT scheduling it. " +
    "His school hour is already on the calendar at the same time every day; this just puts the " +
    "assignment on the list he works through inside that hour, with its due date so the order " +
    "is obvious. If the photo does not make the due date clear, leave it out rather than guessing.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "kind", "estimatedMin"],
    properties: {
      title: { type: "string", description: "What it is, as he would recognise it." },
      kind: { type: "string", enum: ["homework", "test", "project", "reading"] },
      dueDate: {
        type: ["string", "null"],
        description: "YYYY-MM-DD. Null if the image does not say — a guessed due date is worse than none.",
      },
      estimatedMin: { type: "integer", description: "Honest estimate of focused minutes." },
      notes: { type: ["string", "null"], description: "Anything he will need that is not in the title." },
    },
  },
};

export const LOG_METRIC: Anthropic.Tool = {
  name: "log_metric",
  description: "Record a measurement the user reported in conversation, e.g. bodyweight, Quran pages, a lift PR.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["kind", "value"],
    properties: {
      kind: { type: "string", description: "e.g. bodyweight, protein, quran-pages" },
      value: { type: "number" },
      unit: { type: ["string", "null"] },
      onDate: { type: ["string", "null"], description: "YYYY-MM-DD. Defaults to today." },
    },
  },
};


export const logMealInput = z.object({
  mealSlot: z.string(),
  description: z.string(),
  calories: z.number().int().min(0).max(5000),
  proteinG: z.number().int().min(0).max(300),
  verdict: z.string(),
});

export const logWorkoutInput = z.object({
  session: z.string(),
  exercises: z.array(
    z.object({
      name: z.string(),
      sets: z.array(z.object({ reps: z.number().int().min(0), weight: z.number().nullable() })),
    }),
  ),
});

export const LOG_MEAL: Anthropic.Tool = {
  name: "log_meal",
  description:
    "Record a meal from a photo of it. Estimate calories and protein — an estimate that is " +
    "roughly right every day beats an exact number nobody logs. Say in one line whether it " +
    "moves him toward his targets or not.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["mealSlot", "description", "calories", "proteinG", "verdict"],
    properties: {
      mealSlot: { type: "string", description: "breakfast, lunch, after-school, dinner, before-bed or snack" },
      description: { type: "string", description: "What is actually on the plate." },
      calories: { type: "integer" },
      proteinG: { type: "integer" },
      verdict: {
        type: "string",
        description:
          "One line, honest. If it is short on protein say so and say by how much — he is " +
          "underfed and the whole physique goal turns on this.",
      },
    },
  },
};

export const LOG_WORKOUT: Anthropic.Tool = {
  name: "log_workout",
  description: "Record sets from a photo of a written training log.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["session", "exercises"],
    properties: {
      session: { type: "string", description: "push, legs, pull or posterior-shoulders" },
      exercises: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "sets"],
          properties: {
            name: { type: "string" },
            sets: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["reps", "weight"],
                properties: {
                  reps: { type: "integer" },
                  weight: { type: ["number", "null"], description: "Total pounds, or null for bodyweight." },
                },
              },
            },
          },
        },
      },
    },
  },
};

/**
 * What a specialist can do now.
 *
 * No emit_task, no close_task, no declare_need. The calendar is a fixed
 * routine that nothing writes to, so the only side effect a specialist has is
 * recording a measurement. Everything else it does is said, not scheduled.
 */
export const SPECIALIST_TOOLS: Anthropic.Tool[] = [LOG_METRIC, LOG_MEAL, LOG_WORKOUT, LOG_ASSIGNMENT];
