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

export const closeTaskInput = z.object({
  taskId: z.string().min(1),
  status: z.enum(["done", "dropped"]),
  why: z.string().min(1),
});

export type CloseTaskInput = z.infer<typeof closeTaskInput>;

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
    required: ["title", "domain", "durationMin", "energy", "priority", "dayPart", "recurrence"],
    properties: {
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
          "assignment, what to cook. Hidden behind a tap, so put the whole thing here rather " +
          "than cramming it into the title. A block titled 'Lift - Push' with six steps reads " +
          "far better than a title listing six exercises.",
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

export const SPECIALIST_TOOLS: Anthropic.Tool[] = [EMIT_TASK, LOG_METRIC, CLOSE_TASK];
