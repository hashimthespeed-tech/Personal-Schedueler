/**
 * Stage B — the nightly review.
 *
 * Stage A already produced a schedule that satisfies every hard constraint.
 * What it cannot do is judgement: deciding that a chemistry test on Friday
 * outranks a third lifting session, or that a project should be cut down
 * rather than dropped.
 *
 * So this runs over Stage A's output. It never places blocks; it adjusts the
 * inputs — priority, scope, what to drop — and re-runs the solver. That keeps
 * the model out of time arithmetic entirely, which is the one thing it is
 * reliably bad at here.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { planReviews, tasks } from "../db/schema.js";
import { anthropic, AGENT_MODEL, describeApiError } from "./client.js";
import { buildContext, today } from "./context.js";
import { replan, type ReplanResult } from "../core/replan.js";
import { to12h, type IsoDate } from "../core/types.js";

const MAX_ITERATIONS = 2;

const adjustInput = z.object({
  taskId: z.string().min(1),
  priority: z.number().int().min(1).max(5),
  why: z.string().min(1),
});

const shrinkInput = z.object({
  taskId: z.string().min(1),
  durationMin: z.number().int().min(5).max(480),
  why: z.string().min(1),
});

const dropInput = z.object({
  taskId: z.string().min(1),
  why: z.string().min(1),
});

const REVIEW_TOOLS: Anthropic.Tool[] = [
  {
    name: "adjust_priority",
    description: "Change a task's priority so the scheduler treats it differently on the next pass. 1 is highest.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId", "priority", "why"],
      properties: {
        taskId: { type: "string" },
        priority: { type: "integer" },
        why: { type: "string", description: "One sentence, shown to the user verbatim." },
      },
    },
  },
  {
    name: "shrink_task",
    description: "Cut a task's scope so a reduced version fits, instead of dropping it entirely.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId", "durationMin", "why"],
      properties: {
        taskId: { type: "string" },
        durationMin: { type: "integer" },
        why: { type: "string" },
      },
    },
  },
  {
    name: "drop_task",
    description: "Remove a task from the week. Use when something genuinely has to give.",
    strict: true,
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["taskId", "why"],
      properties: {
        taskId: { type: "string" },
        why: { type: "string" },
      },
    },
  },
];

const REVIEW_SYSTEM = `You review a schedule that has already been solved.

A deterministic solver has placed this week's work against every hard
constraint — sleep, school, practice, prayer times, injury restrictions,
time-of-day windows, spacing. Its output is correct. Your job is the part it
cannot do: judgement about what matters this week.

## What you can change

You cannot place blocks and you cannot pick times. You adjust the inputs —
priority, scope, what to drop — and the solver re-runs. That is deliberate:
you are good at trade-offs and bad at time arithmetic.

## How to decide

Look at what did not fit. For each, ask whether it should have displaced
something that did. A test on Friday outranks a third lifting session. A
deadline outranks a preference. Shrinking a task usually beats dropping it.

Be willing to cut. A week where everything is priority 1 is a week where the
solver picks arbitrarily. If he is overcommitted, say so plainly and make the
call rather than leaving it to him at 10pm on a Thursday.

Respect the gate: if the coach's view says he cannot add training load, do not
promote training work over recovery or eating.

## Your written summary

End with a short plain-English note: what you changed and why. Two or three
sentences, conversational, addressed to him. He reads this over breakfast. If
you changed nothing, say the week looks fine and why.`;

export interface ReviewResult {
  summary: string;
  changes: { action: string; taskId: string; why: string }[];
  plan: ReplanResult;
}

function describePlan(plan: ReplanResult): string {
  const lines: string[] = [];
  lines.push(`## Solver output — plan v${plan.planVersion}, week of ${plan.startDate}`);
  lines.push(
    `Utilization: ${Math.round(plan.utilization * 100)}% of ${(plan.freeMinutes / 60).toFixed(1)}h free time.`,
  );

  lines.push(`\n### Scheduled`);
  if (plan.blocks.length === 0) {
    lines.push("Nothing.");
  } else {
    let currentDate = "";
    for (const b of plan.blocks) {
      if (b.date !== currentDate) {
        currentDate = b.date;
        lines.push(`\n${b.date}`);
      }
      lines.push(`  ${to12h(b.start)}-${to12h(b.end)} [${b.domain}] ${b.title} (task ${b.taskId})`);
    }
  }

  lines.push(`\n### Did not fit`);
  if (plan.unplaced.length === 0) {
    lines.push("Everything fit.");
  } else {
    for (const u of plan.unplaced) {
      lines.push(`  [${u.domain}] ${u.title} (task ${u.taskId}) — ${u.detail}`);
    }
  }

  return lines.join("\n");
}

export async function runReview(date: IsoDate = today()): Promise<ReviewResult> {
  let plan = await replan(date);
  const changes: { action: string; taskId: string; why: string }[] = [];

  const [coachView, tutorView] = await Promise.all([
    buildContext("coach", date),
    buildContext("tutor", date),
  ]);

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `${coachView}\n\n${tutorView}\n\n${describePlan(plan)}\n\nReview this week.`,
    },
  ];

  let summary = "";

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      const response = await anthropic().messages.create({
        model: AGENT_MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        system: [{ type: "text", text: REVIEW_SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: REVIEW_TOOLS,
        messages,
      });

      if (response.stop_reason === "refusal") {
        summary = "Review could not run.";
        break;
      }

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      if (toolUses.length === 0) {
        summary = text;
        break;
      }

      messages.push({ role: "assistant", content: response.content });
      summary = text || summary;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolUses) {
        try {
          let out: string;
          if (call.name === "adjust_priority") {
            const p = adjustInput.parse(call.input);
            await db.update(tasks).set({ priority: p.priority }).where(eq(tasks.id, p.taskId));
            changes.push({ action: "reprioritized", taskId: p.taskId, why: p.why });
            out = `Priority for ${p.taskId} is now ${p.priority}.`;
          } else if (call.name === "shrink_task") {
            const p = shrinkInput.parse(call.input);
            await db.update(tasks).set({ durationMin: p.durationMin }).where(eq(tasks.id, p.taskId));
            changes.push({ action: "shrunk", taskId: p.taskId, why: p.why });
            out = `${p.taskId} cut to ${p.durationMin}min.`;
          } else if (call.name === "drop_task") {
            const p = dropInput.parse(call.input);
            await db.update(tasks).set({ status: "dropped" }).where(eq(tasks.id, p.taskId));
            changes.push({ action: "dropped", taskId: p.taskId, why: p.why });
            out = `${p.taskId} dropped.`;
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

      // re-solve with the adjusted inputs and hand back the new plan. Every
      // tool_use gets exactly one tool_result; the re-solved plan rides along
      // as a text block in the same user turn.
      plan = await replan(date);
      const last = iteration === MAX_ITERATIONS - 1;
      messages.push({
        role: "user",
        content: [
          ...results,
          {
            type: "text",
            text: `Re-solved.\n\n${describePlan(plan)}\n\n${
              last
                ? "Write your summary now — no further changes."
                : "Make further changes if the week still does not work, otherwise write your summary."
            }`,
          },
        ],
      });
    }
  } catch (error) {
    throw new Error(describeApiError(error));
  }

  await db.insert(planReviews).values({
    planVersion: plan.planVersion,
    onDate: date,
    summary: summary || "No changes.",
    changes,
  });

  return { summary: summary || "No changes.", changes, plan };
}
