/**
 * The specialist agent loop.
 *
 * A plain tool loop rather than the SDK's beta tool runner: the tool surface is
 * three calls wide and this keeps the whole thing dependency-free and easy to
 * reason about when a tool call misbehaves.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { agentThreads, metrics, tasks } from "../db/schema";
import { anthropic, AGENT_MODEL, describeApiError } from "./client";
import { SPECIALIST_TOOLS, emitTaskInput, logMetricInput, closeTaskInput } from "./tools";
import { SPECIALISTS, type SpecialistName } from "./specialists";
import { buildContext, today } from "./context";
import { replan } from "../core/replan";
import { hm, type IsoDate } from "../core/types";

const MAX_TURNS = 8;
const MAX_TOKENS = 16000;

export interface AgentReply {
  text: string;
  /** what the agent actually changed, for the UI to show */
  actions: string[];
  replanned: boolean;
}

function textOf(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}

async function persistTask(input: unknown, agent: SpecialistName): Promise<string> {
  const parsed = emitTaskInput.parse(input);
  const id = `${agent}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
    spacingHours: parsed.spacingHours ?? null,
    spacingGroup: parsed.spacingGroup ?? null,
    allowedWeekdays: parsed.allowedWeekdays ?? null,
    movementTags: parsed.movementTags ?? null,
    sourceAgent: agent,
  });

  return `Added "${parsed.title}" (${parsed.durationMin}min, ${parsed.domain}, priority ${parsed.priority}). The scheduler will place it.`;
}

async function persistMetric(input: unknown, date: IsoDate): Promise<string> {
  const parsed = logMetricInput.parse(input);
  await db.insert(metrics).values({
    onDate: parsed.onDate ?? date,
    kind: parsed.kind,
    value: parsed.value,
    unit: parsed.unit ?? null,
  });
  return `Logged ${parsed.kind} = ${parsed.value}${parsed.unit ? ` ${parsed.unit}` : ""}.`;
}

async function persistClose(input: unknown): Promise<string> {
  const parsed = closeTaskInput.parse(input);
  const updated = await db
    .update(tasks)
    .set({ status: parsed.status })
    .where(eq(tasks.id, parsed.taskId))
    .returning({ title: tasks.title });

  const row = updated[0];
  if (!row) return `No task with id ${parsed.taskId}.`;
  return `Marked "${row.title}" ${parsed.status}.`;
}

export async function runSpecialist(
  agent: SpecialistName,
  userMessage: string,
  date: IsoDate = today(),
): Promise<AgentReply> {
  const spec = SPECIALISTS[agent];
  const context = await buildContext(agent, date);

  const history = await db
    .select()
    .from(agentThreads)
    .where(eq(agentThreads.agent, agent))
    .orderBy(agentThreads.createdAt);

  const messages: Anthropic.MessageParam[] = history
    .slice(-20)
    .map((h) => ({ role: h.role as "user" | "assistant", content: h.content }));

  messages.push({ role: "user", content: userMessage });
  await db.insert(agentThreads).values({ agent, role: "user", content: userMessage });

  const actions: string[] = [];
  let poolChanged = false;
  let reply = "";

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await anthropic().messages.create({
        model: AGENT_MODEL,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        system: [
          // stable: cached across every turn in this thread
          { type: "text", text: spec.systemPrompt, cache_control: { type: "ephemeral" } },
          // volatile: rebuilt per request
          { type: "text", text: context },
        ],
        tools: SPECIALIST_TOOLS,
        messages,
      });

      if (response.stop_reason === "refusal") {
        reply = "I can't help with that one.";
        break;
      }

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );

      if (toolUses.length === 0) {
        reply = textOf(response.content);
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolUses) {
        try {
          let out: string;
          if (call.name === "emit_task") {
            out = await persistTask(call.input, agent);
            poolChanged = true;
          } else if (call.name === "log_metric") {
            out = await persistMetric(call.input, date);
          } else if (call.name === "close_task") {
            out = await persistClose(call.input);
            poolChanged = true;
          } else {
            out = `Unknown tool ${call.name}.`;
          }
          actions.push(out);
          results.push({ type: "tool_result", tool_use_id: call.id, content: out });
        } catch (error) {
          // a failed tool still gets a result, or the next turn is malformed
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
      // text emitted alongside the tool calls is worth keeping if the loop ends here
      reply = textOf(response.content) || reply;
    }
  } catch (error) {
    throw new Error(describeApiError(error));
  }

  if (reply) {
    await db.insert(agentThreads).values({ agent, role: "assistant", content: reply });
  }

  if (poolChanged) await replan(date);

  return { text: reply, actions, replanned: poolChanged };
}
