/**
 * Image intake.
 *
 * The phone's job is capture, not conversation. Photograph an assignment
 * sheet, a plate of food, the scale, and the right specialist turns it into
 * something the system can use. The back-and-forth happens at a keyboard.
 *
 * Every call is one-shot. What differs is the destination: schoolwork becomes
 * tasks, a meal becomes calories and protein, a scale photo becomes a
 * bodyweight the Coach's gate actually depends on.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "@/db/index";
import { agentThreads, assignments, courses, goals, liftLog, metrics, tasks } from "@/db/schema";
import { anthropic, AGENT_MODEL, describeApiError } from "./client";
import {
  EMIT_TASK, LOG_METRIC, LOG_MEAL, LOG_WORKOUT,
  emitTaskInput, logMetricInput, logMealInput, logWorkoutInput,
} from "./tools";
import { buildContext, today } from "./context";
import { replan } from "@/core/replan";
import { hm, type IsoDate } from "@/core/types";
import type { SpecialistName } from "./specialists";
import type { CaptureKind, CaptureTarget } from "@/data/capture-targets";

const MAX_TURNS = 3;

export interface CaptureResult {
  summary: string;
  created: string[];
  replanned: boolean;
}

const SHARED = `You turn a photograph into something the system can use.

This arrives from a phone, mid-day, with no conversation attached. Read the
image, do the one job below, then say in two or three sentences what you found.

If the image is unclear, say so and ask for a better photo. A blurry sheet you
half-read becomes a task that is wrong in a way nobody notices until the
deadline passes, and a guessed meal becomes a number that quietly corrupts
weeks of data. Refusing is cheap; being wrong is not.`;

const BY_KIND: Record<CaptureKind, string> = {
  homework: `${SHARED}

## Your job: turn this into scheduled work

One task per distinct piece of work. Four problem sets due at different times
are four tasks; four due together are one sitting.

Put the specifics in steps — the problem numbers, the pages, the questions.
The title stays short. The point is that he can open the block later and know
what to do without finding the sheet again.

Estimate durationMin honestly; a worksheet is not fifteen minutes. Set dayPart
and recurrence on everything and link each task to a goal with goalId.

A due date on the sheet is a hard deadline. Without it the scheduler has no
idea this is urgent.`,

  syllabus: `${SHARED}

## Your job: extract every dated commitment

This is a syllabus, calendar or planner covering several weeks. Emit a task
for each dated item with its deadline.

Do not invent dates. If a row has no date, say so rather than guessing one —
a wrong deadline is worse than a missing one, because the scheduler will act
on it.

Tests and projects get more estimated time than homework, and should be
splittable so they can be spread across several days.`,

  meal: `${SHARED}

## Your job: log what he ate

Call log_meal. Estimate calories and protein from what is visibly on the
plate. Being roughly right every day beats being exactly right once.

He is 125 lb, trying to gain, eating about 2,900 calories and 120g protein a
day. He is underfed — that is the actual limiter on his physique goal, not
his training. So the verdict line matters: if the plate is short on protein,
say so and say by roughly how much. Do not be encouraging about a meal that
will not get him there.

Do not create tasks for a meal photo. It has already happened.`,

  bodyweight: `${SHARED}

## Your job: read the scale

Call log_metric with kind "bodyweight" and the number in pounds. If the scale
reads kilograms, convert it and say that you did.

This one measurement is what the Coach's whole progression gate depends on —
without it, load holds indefinitely. If you cannot read the number, say so
clearly rather than guessing; a wrong weight moves the trend line and the gate
acts on the trend.`,

  workout: `${SHARED}

## Your job: log the sets

Call log_workout with each exercise and its sets. Weight is total pounds on
the bar, or null for bodyweight work.

His plates only build 20, 40, 50, 70, 90, 100 and 120 lb. A number outside
that list is probably a misread — say so rather than recording it.`,

  note: `${SHARED}

## Your job: work out what this is

It might be something to do, in which case emit a task for it. It might be
information worth keeping, in which case just describe what you see.

Do not manufacture a task out of something that is only a note. A task pool
full of things that were never really commitments is how a schedule stops
being believable.`,
};

export async function runCapture(
  target: CaptureTarget,
  imageBase64: string,
  mediaType: string,
  note: string,
  date: IsoDate = today(),
): Promise<CaptureResult> {
  const agent: SpecialistName = target.agent;
  const context = await buildContext(agent, date);
  const courseRows = await db.select().from(courses).orderBy(courses.period);
  const goalRows = await db.select().from(goals).where(eq(goals.active, true));

  const course = target.courseCode ? courseRows.find((c) => c.code === target.courseCode) : undefined;

  const tools: Anthropic.Tool[] =
    target.kind === "meal"
      ? [LOG_MEAL]
      : target.kind === "bodyweight"
        ? [LOG_METRIC]
        : target.kind === "workout"
          ? [LOG_WORKOUT]
          : [EMIT_TASK];

  const subject = course
    ? `This is for ${course.name} (period ${course.period}, ${course.teacher ?? "unknown teacher"}).`
    : `Category: ${target.label}.`;

  const goalList = goalRows.map((g) => `goalId ${g.id} [${g.domain}] ${g.northStar}`).join("\n");

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: imageBase64,
          },
        },
        {
          type: "text",
          text:
            `${subject}\n` +
            (target.mealSlot ? `Meal: ${target.mealSlot}.\n` : "") +
            `Today is ${date}.\n\n` +
            `Goals:\n${goalList}\n\n` +
            (note ? `What he said about it: "${note}"\n\n` : "") +
            `Current state for reference:\n${context}`,
        },
      ],
    },
  ];

  const created: string[] = [];
  let summary = "";
  let poolChanged = false;

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await anthropic().messages.create({
        model: AGENT_MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: [{ type: "text", text: BY_KIND[target.kind], cache_control: { type: "ephemeral" } }],
        tools,
        messages,
      });

      if (response.stop_reason === "refusal") {
        summary = "I couldn't work with that one.";
        break;
      }

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length === 0) {
        summary = text || summary;
        break;
      }

      messages.push({ role: "assistant", content: response.content });
      summary = text || summary;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolUses) {
        try {
          let out: string;

          if (call.name === "emit_task") {
            const parsed = emitTaskInput.parse(call.input);
            const id = `${agent}-cap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            await db.insert(tasks).values({
              id,
              domain: parsed.domain,
              title: parsed.title,
              notes: parsed.notes ?? null,
              durationMin: parsed.durationMin,
              minChunkMin: parsed.minChunkMin ?? null,
              deadline: parsed.deadline ?? null,
              earliestTime: parsed.earliestTime ? hm(parsed.earliestTime) : null,
              latestTime: parsed.latestTime ? hm(parsed.latestTime) : null,
              energy: parsed.energy,
              priority: parsed.priority,
              dayPart: parsed.dayPart,
              recurrence: parsed.recurrence,
              oncePerDay: parsed.oncePerDay ?? false,
              steps: parsed.steps ?? null,
              goalId: parsed.goalId ?? null,
              allowedWeekdays: parsed.allowedWeekdays ?? null,
              movementTags: parsed.movementTags ?? null,
              sourceAgent: agent,
              sourceRef: `capture:${target.id}`,
            });

            if (parsed.domain === "school" && parsed.deadline) {
              await db.insert(assignments).values({
                courseId: course?.id ?? null,
                title: parsed.title,
                kind: "homework",
                dueDate: parsed.deadline,
                estimatedMin: parsed.durationMin,
                notes: parsed.steps?.join("\n") ?? null,
              });
            }

            const label = `${parsed.title}${parsed.deadline ? ` (due ${parsed.deadline})` : ""}`;
            created.push(label);
            poolChanged = true;
            out = `Added "${label}".`;
          } else if (call.name === "log_meal") {
            const parsed = logMealInput.parse(call.input);
            await db.insert(metrics).values([
              { onDate: date, kind: "calories", value: parsed.calories, unit: "kcal" },
              { onDate: date, kind: "protein", value: parsed.proteinG, unit: "g" },
            ]);
            const label = `${parsed.mealSlot}: ${parsed.calories} kcal, ${parsed.proteinG}g protein`;
            created.push(label);
            out = `Logged ${label}.`;
          } else if (call.name === "log_metric") {
            const parsed = logMetricInput.parse(call.input);
            await db.insert(metrics).values({
              onDate: parsed.onDate ?? date,
              kind: parsed.kind,
              value: parsed.value,
              unit: parsed.unit ?? null,
            });
            const label = `${parsed.kind} ${parsed.value}${parsed.unit ?? ""}`;
            created.push(label);
            out = `Logged ${label}.`;
          } else if (call.name === "log_workout") {
            const parsed = logWorkoutInput.parse(call.input);
            let sets = 0;
            for (const ex of parsed.exercises) {
              for (const [i, set] of ex.sets.entries()) {
                await db.insert(liftLog).values({
                  onDate: date,
                  session: parsed.session,
                  exerciseName: ex.name,
                  setIndex: i + 1,
                  reps: set.reps,
                  weight: set.weight,
                });
                sets += 1;
              }
            }
            const label = `${parsed.exercises.length} exercises, ${sets} sets`;
            created.push(label);
            out = `Logged ${label}.`;
          } else {
            out = `Unknown tool ${call.name}.`;
          }

          results.push({ type: "tool_result", tool_use_id: call.id, content: out });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: `Failed: ${message}`,
            is_error: true,
          });
        }
      }

      messages.push({ role: "user", content: results });
    }
  } catch (error) {
    throw new Error(describeApiError(error));
  }

  // leave a trace so the desktop hub has the context of what the phone did
  if (summary) {
    await db.insert(agentThreads).values([
      { agent, role: "user", content: `[photo — ${target.label}${note ? `: ${note}` : ""}]` },
      { agent, role: "assistant", content: summary },
    ]);
  }

  if (poolChanged) await replan(date);

  return { summary: summary || "Nothing to record from that.", created, replanned: poolChanged };
}
