/**
 * Image intake.
 *
 * The phone's job is capture, not conversation: photograph an assignment
 * sheet or a whiteboard, and the right specialist turns it into tasks. The
 * back-and-forth — actually being tutored — happens at a keyboard.
 *
 * So this is deliberately one-shot. It reads the image, emits tasks, and
 * reports what it made. It does not open a thread.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "@/db/index";
import { agentThreads, assignments, courses, goals, tasks } from "@/db/schema";
import { anthropic, AGENT_MODEL, describeApiError } from "./client";
import { EMIT_TASK, emitTaskInput } from "./tools";
import { buildContext, today } from "./context";
import { replan } from "@/core/replan";
import { hm, type IsoDate } from "@/core/types";
import type { SpecialistName } from "./specialists";

const MAX_TURNS = 3;

export type CaptureKind = "homework" | "schedule" | "note";

export interface CaptureResult {
  summary: string;
  created: string[];
  replanned: boolean;
}

const CAPTURE_SYSTEM = `You turn a photograph into scheduled work.

This arrives from a phone, mid-day, with no conversation attached. Read the
image, work out what it commits the student to, and emit tasks for it. Then
say in two or three sentences what you found and what you added.

## Rules

Emit one task per distinct piece of work. An assignment sheet listing four
problems sets is four tasks if they are due at different times, one task if
they are one sitting.

Put the detail in steps — the specific problems, pages, or questions. The
title stays short. The point of steps is that the student can open the block
later and know exactly what to do without finding the sheet again.

Estimate durationMin honestly. A worksheet is not 15 minutes.

Set dayPart and recurrence on every task, and link each to a goal with
goalId. Reading period 7 is "after-school" and on campus; anything needing
real focus is "evening".

deadline matters most here. A due date on the sheet is a hard deadline —
without it the scheduler has no idea this is urgent.

## When the image is unclear

Say so plainly rather than inventing an assignment. A blurry photo that you
half-read produces a task that is wrong in a way nobody notices until the
deadline passes. Ask for a clearer photo instead.`;

export async function runCapture(
  agent: SpecialistName,
  imageBase64: string,
  mediaType: string,
  note: string,
  kind: CaptureKind,
  date: IsoDate = today(),
): Promise<CaptureResult> {
  const context = await buildContext(agent, date);
  const courseRows = await db.select().from(courses).orderBy(courses.period);
  const goalRows = await db.select().from(goals).where(eq(goals.active, true));

  const courseList = courseRows.map((c) => `P${c.period} ${c.name} (${c.code}, domain ${c.domain})`).join("\n");
  const goalList = goalRows.map((g) => `goalId ${g.id} [${g.domain}] ${g.northStar}`).join("\n");

  const kindHint =
    kind === "homework"
      ? "This is an assignment or worksheet."
      : kind === "schedule"
        ? "This is a schedule, calendar or syllabus — extract dated commitments."
        : "This is a note or reminder.";

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
            `${kindHint}\n\nToday is ${date}.\n\n` +
            `Courses:\n${courseList}\n\nGoals:\n${goalList}\n\n` +
            (note ? `What he said about it: "${note}"\n\n` : "") +
            `Current state for reference:\n${context}`,
        },
      ],
    },
  ];

  const created: string[] = [];
  let summary = "";

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await anthropic().messages.create({
        model: AGENT_MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: [{ type: "text", text: CAPTURE_SYSTEM, cache_control: { type: "ephemeral" } }],
        tools: [EMIT_TASK],
        messages,
      });

      if (response.stop_reason === "refusal") {
        summary = "I couldn't read that one.";
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
            sourceRef: "capture",
          });

          if (parsed.domain === "school" && parsed.deadline) {
            await db.insert(assignments).values({
              title: parsed.title,
              kind: "homework",
              dueDate: parsed.deadline,
              estimatedMin: parsed.durationMin,
              notes: parsed.steps?.join("\n") ?? null,
            });
          }

          const label = `${parsed.title}${parsed.deadline ? ` (due ${parsed.deadline})` : ""}`;
          created.push(label);
          results.push({ type: "tool_result", tool_use_id: call.id, content: `Added "${label}".` });
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

  // capture leaves a trace in the thread so the desktop hub has the context
  if (summary) {
    await db.insert(agentThreads).values([
      { agent, role: "user", content: `[photo from phone${note ? `: ${note}` : ""}]` },
      { agent, role: "assistant", content: summary },
    ]);
  }

  const replanned = created.length > 0;
  if (replanned) await replan(date);

  return { summary: summary || "Nothing to add from that.", created, replanned };
}
