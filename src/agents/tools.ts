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

export const emitTaskInput = z.object({
  key: z.string().min(1).max(60).regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  domain: z.enum(DOMAINS),
  durationMin: z.number().int().min(5).max(480),
  minChunkMin: z.number().int().min(5).max(480).nullable().optional(),
  deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  earliestTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  latestTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  energy: z.enum(["high", "med", "low"]),
  priority: z.number().int().min(1).max(5),
  dayPart: z.enum(["morning", "midday", "after-school", "evening", "bedtime", "anytime"]),
  recurrence: z.enum(["once", "daily", "weekdays", "weekends", "weekly"]),
  allowedWeekdays: z.array(z.number().int().min(1).max(7)).nullable().optional(),
  spacingHours: z.number().int().min(0).max(336).nullable().optional(),
  spacingGroup: z.string().nullable().optional(),
  movementTags: z.array(z.string()).nullable().optional(),
  notes: z.string().nullable().optional(),
  steps: z.array(z.string()).nullable().optional(),
  oncePerDay: z.boolean().nullable().optional(),
  goalId: z.number().int().nullable().optional(),
});

export type EmitTaskInput = z.infer<typeof emitTaskInput>;

export const logMetricInput = z.object({
  kind: z.string().min(1),
  value: z.number(),
  unit: z.string().nullable().optional(),
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export type LogMetricInput = z.infer<typeof logMetricInput>;

export const declareNeedInput = z.object({
  question: z.string().min(1).max(300),
  why: z.string().min(1).max(300),
  urgency: z.number().int().min(1).max(3),
});

export type DeclareNeedInput = z.infer<typeof declareNeedInput>;

export const closeTaskInput = z.object({
  taskId: z.string().min(1),
  status: z.enum(["done", "dropped"]),
  why: z.string().min(1),
});

export type CloseTaskInput = z.infer<typeof closeTaskInput>;

export const DECLARE_NEED: Anthropic.Tool = {
  name: "declare_need",
  description:
    "Say what you do not know that is stopping you planning properly — a test date you " +
    "were never told, how much Quran he wants to read each day, what the project even is. " +
    "Do not guess around a gap and do not bury the question in a reply he may not read: " +
    "declare it, and the planner puts a few minutes on his calendar to come and tell you. " +
    "Only declare what actually blocks planning; a nice-to-have is noise.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["question", "why", "urgency"],
    properties: {
      question: {
        type: "string",
        description: "Ask him directly, in his words. 'What tests do you have in the next two weeks?'",
      },
      why: {
        type: "string",
        description: "One line on what you cannot plan until he answers.",
      },
      urgency: {
        type: "integer",
        description: "1 = nothing sensible can be planned without it. 2 = the plan is worse. 3 = would help.",
      },
    },
  },
};

export const EMIT_TASK: Anthropic.Tool = {
  name: "emit_task",
  description:
    "Add a unit of work to the shared pool with the constraints that govern it. " +
    "You are describing WHAT needs doing and what rules it must obey. You are NOT " +
    "choosing when it happens — the scheduler places it. Do not pick a date or a " +
    "clock time; express the real constraint instead: which part of the day it belongs " +
    "in, how often it repeats, a deadline, which weekdays, how far apart repeats must be. " +
    "Before adding anything, check the task pool you were shown — if it is already there, " +
    "do not emit it again.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["key", "title", "domain", "durationMin", "energy", "priority", "dayPart", "recurrence", "steps"],
    properties: {
      key: {
        type: "string",
        description:
          "A short stable slug for this piece of work, lowercase with hyphens — 'lift-a', " +
          "'morning-weigh-in', 'apush-ch12'. It is the task's identity. Emitting the same key " +
          "again updates that task instead of adding a second one, so use the SAME key whenever " +
          "you mean the same work, even if you would word the title differently this time. " +
          "Getting this wrong is how a plan ends up on the calendar twice under two names.",
      },
      title: { type: "string", description: "Short and concrete, e.g. 'APUSH ch. 12 reading'." },
      domain: { type: "string", enum: [...DOMAINS] },
      durationMin: { type: "integer", description: "Honest estimate of focused minutes." },
      minChunkMin: {
        type: ["integer", "null"],
        description:
          "Smallest useful sitting, if this can be split across sessions. Null means it must be done in one block.",
      },
      deadline: { type: ["string", "null"], description: "YYYY-MM-DD. Only if genuinely hard." },
      earliestTime: {
        type: ["string", "null"],
        description: "HH:MM. Earliest time of day this may start, if there is a real reason.",
      },
      latestTime: { type: ["string", "null"], description: "HH:MM. Latest time of day this may end." },
      energy: {
        type: "string",
        enum: ["high", "med", "low"],
        description:
          "How much focus it truly needs. Reserve 'high' for work that is wasted when tired — the high-energy morning block is scarce.",
      },
      priority: { type: "integer", description: "1 is highest. Be honest; everything cannot be a 1." },
      dayPart: {
        type: "string",
        enum: ["morning", "midday", "after-school", "evening", "bedtime", "anytime"],
        description:
          "Which part of the day this belongs in. Required, and getting it wrong is worse than " +
          "it sounds: a meal marked 'anytime' will be scheduled at 7am, and a wind-down routine " +
          "at 6:50am. 'morning' is before school. 'after-school' shifts automatically to 5:30pm " +
          "on practice days. 'bedtime' is the 90 minutes before lights out. Use 'anytime' only " +
          "when the work genuinely could happen at any hour.",
      },
      recurrence: {
        type: "string",
        enum: ["once", "daily", "weekdays", "weekends", "weekly"],
        description:
          "How often this repeats. A daily habit — weighing in, breakfast, a wind-down — is " +
          "'daily', NOT 'once'. Emitting a habit as 'once' places it on a single arbitrary day " +
          "and never again. Use 'once' only for a specific piece of work with an end.",
      },
      allowedWeekdays: {
        type: ["array", "null"],
        items: { type: "integer" },
        description: "1=Mon .. 7=Sun. Only when it genuinely can only happen on those days.",
      },
      spacingHours: {
        type: ["integer", "null"],
        description: "Minimum hours between repeats of the same group, e.g. 48 between heavy leg sessions.",
      },
      spacingGroup: { type: ["string", "null"], description: "Group key that spacingHours applies to." },
      movementTags: {
        type: ["array", "null"],
        items: { type: "string" },
        description:
          "Physique work only. Movement patterns involved, checked against injury restrictions before the task is ever placed.",
      },
      notes: {
        type: ["string", "null"],
        description: "One line shown on the block itself. Keep it short — detail goes in steps.",
      },
      steps: {
        type: ["array", "null"],
        items: { type: "string" },
        description:
          "The detail, one item per line — exercises with sets and reps, the parts of an " +
          "assignment, what to cook. Required, because a block with no steps is a block he " +
          "opens and learns nothing from: 'Lift A' on its own does not tell him what to lift. " +
          "Put the whole session here rather than cramming it into the title. Null only when " +
          "the title genuinely says everything, like a weigh-in.",
      },
      oncePerDay: {
        type: ["boolean", "null"],
        description:
          "True when at most one of this kind of work should happen per day — training " +
          "sessions, for instance. The scheduler enforces it; deciding it is yours. Without " +
          "it, three separate lifts can all land on the same day, each individually legal.",
      },
      goalId: {
        type: ["integer", "null"],
        description:
          "Which goal completing this counts toward, from the goals list you were shown. " +
          "This is what makes progress measurable — an unlinked task contributes to nothing.",
      },
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

export const CLOSE_TASK: Anthropic.Tool = {
  name: "close_task",
  description: "Mark an existing task done or dropped. Use when the user says they finished it, or it is no longer worth doing.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["taskId", "status", "why"],
    properties: {
      taskId: { type: "string" },
      status: { type: "string", enum: ["done", "dropped"] },
      why: { type: "string" },
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

export const SPECIALIST_TOOLS: Anthropic.Tool[] = [EMIT_TASK, LOG_METRIC, CLOSE_TASK, DECLARE_NEED];
