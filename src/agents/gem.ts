/**
 * Running a gem.
 *
 * A gem is a base specialist plus a narrower brief plus whatever it has
 * chosen to remember. Conversations live under the gem, so a new chat starts
 * fresh in history but not in knowledge.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import { attachments, conversations, gems, messages, metrics, tasks } from "@/db/schema";
import { isImage } from "@/lib/attachments";
import { anthropic, AGENT_MODEL, describeApiError } from "./client";
import { SPECIALIST_TOOLS, emitTaskInput, logMetricInput, closeTaskInput } from "./tools";
import { SPECIALISTS, isSpecialist, type SpecialistName } from "./specialists";
import { buildContext, today } from "./context";
import { replan } from "@/core/replan";
import { hm, type IsoDate } from "@/core/types";
import type { GemSeed } from "@/data/gems";

const MAX_TURNS = 4;

const rememberInput = z.object({
  note: z.string().min(1).max(2000),
});

const REMEMBER: Anthropic.Tool = {
  name: "remember",
  description:
    "Save something worth carrying into future conversations with him — what he keeps " +
    "getting wrong in this subject, where a project actually stands, what he has already " +
    "tried. This is the only thing that survives when he starts a new chat, so use it for " +
    "what would otherwise have to be re-explained, not for a summary of what was just said.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["note"],
    properties: {
      note: { type: "string", description: "One or two sentences. Specific beats general." },
    },
  },
};

export interface GemReply {
  text: string;
  actions: string[];
  replanned: boolean;
}

function baseAgent(agent: string): SpecialistName {
  return isSpecialist(agent) ? agent : "tutor";
}

/**
 * Fold a stored thread into the alternating shape the API requires.
 *
 * Two things break the alternation. A reply that fails after the message was
 * already saved leaves two user turns in a row, and one bad turn would then
 * poison every later one in that chat. And taking the last thirty rows can
 * start the window on an assistant turn, which the API rejects outright.
 */
export type Turn = { role: string; content: string | Anthropic.ContentBlockParam[] };

function asBlocks(content: string | Anthropic.ContentBlockParam[]): Anthropic.ContentBlockParam[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

export function alternate(rows: Turn[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const row of rows) {
    const role = row.role === "assistant" ? "assistant" : "user";
    const last = out[out.length - 1];

    if (last && last.role === role) {
      last.content =
        typeof last.content === "string" && typeof row.content === "string"
          ? `${last.content}\n\n${row.content}`
          : [...asBlocks(last.content), ...asBlocks(row.content)];
      continue;
    }

    out.push({ role, content: row.content });
  }

  if (out[0]?.role === "assistant") out.shift();
  return out;
}

export interface PendingFile {
  name: string;
  mediaType: string;
  /** base64, no data: prefix */
  data: string;
}

type StoredFile = { name: string; mediaType: string; data: string | null };

/**
 * How many files the thread carries in full.
 *
 * A worksheet has to stay visible for the whole conversation about it, so
 * dropping attachments after one turn is not an option. But a year of them is
 * not affordable either, so the newest few go in whole and the rest become a
 * line of text saying what was there.
 */
const MAX_INLINE_FILES = 8;

/** Files for a window of messages, newest first, budgeted to what fits. */
async function attachmentsFor(messageIds: number[]): Promise<Map<number, StoredFile[]>> {
  const byMessage = new Map<number, StoredFile[]>();
  if (messageIds.length === 0) return byMessage;

  const rows = await db
    .select()
    .from(attachments)
    .where(inArray(attachments.messageId, messageIds))
    .orderBy(asc(attachments.id));

  // newest first, so the budget is spent on what the conversation is about now
  let budget = MAX_INLINE_FILES;
  const keep = new Set<number>();
  for (const row of [...rows].reverse()) {
    if (budget <= 0) break;
    keep.add(row.id);
    budget -= 1;
  }

  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    list.push({
      name: row.name,
      mediaType: row.mediaType,
      data: keep.has(row.id) ? row.data : null,
    });
    byMessage.set(row.messageId, list);
  }

  return byMessage;
}

/** One stored turn as the content blocks the API wants. */
function withFiles(text: string, files: StoredFile[] | undefined): string | Anthropic.ContentBlockParam[] {
  if (!files || files.length === 0) return text;

  const blocks: Anthropic.ContentBlockParam[] = [];
  for (const file of files) {
    if (!file.data) {
      blocks.push({ type: "text", text: `[${file.name} — sent earlier in this chat]` });
    } else if (isImage(file.mediaType)) {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: file.mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
          data: file.data,
        },
      });
    } else {
      blocks.push({
        type: "document",
        title: file.name,
        source: { type: "base64", media_type: "application/pdf", data: file.data },
      });
    }
  }

  if (text.trim()) blocks.push({ type: "text", text });
  return blocks;
}

/** First user message becomes the conversation title, trimmed to fit a sidebar. */
function titleFrom(message: string): string {
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length <= 48 ? clean : `${clean.slice(0, 45)}…`;
}

export async function runGem(
  conversationId: number,
  userMessage: string,
  pending: PendingFile[] = [],
  date: IsoDate = today(),
): Promise<GemReply> {
  const convo = (
    await db.select().from(conversations).where(eq(conversations.id, conversationId)).limit(1)
  )[0];
  if (!convo) throw new Error("No such conversation.");

  const gem = (await db.select().from(gems).where(eq(gems.id, convo.gemId)).limit(1))[0];
  if (!gem) throw new Error("No such gem.");

  const agent = baseAgent(gem.agent);
  const spec = SPECIALISTS[agent];
  const context = await buildContext(agent, date);

  const history = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.createdAt));

  const window = history.slice(-30);
  const files = await attachmentsFor(window.map((m) => m.id));
  const thread = alternate([
    ...window.map((m) => ({ role: m.role, content: withFiles(m.content, files.get(m.id)) })),
    {
      role: "user",
      content: withFiles(userMessage, pending.map((f) => ({ ...f, data: f.data }))),
    },
  ]);

  // Cache the conversation so far, not only the system block. A tutoring thread
  // re-sends its worksheet on every turn, and once there are images in it they
  // dominate what gets re-read. The breakpoint goes on the last block of the
  // last message, so the next turn reuses everything up to here.
  const last = thread[thread.length - 1];
  if (last) {
    const blocks = asBlocks(last.content);
    const tail = blocks[blocks.length - 1];
    if (tail && tail.type !== "thinking" && tail.type !== "redacted_thinking") {
      tail.cache_control = { type: "ephemeral" };
      last.content = blocks;
    }
  }

  const saved = await db
    .insert(messages)
    .values({ conversationId, role: "user", content: userMessage })
    .returning({ id: messages.id });

  const messageId = saved[0]?.id;
  if (messageId && pending.length > 0) {
    await db.insert(attachments).values(
      pending.map((file) => ({
        messageId,
        name: file.name,
        mediaType: file.mediaType,
        bytes: Math.round((file.data.length * 3) / 4),
        data: file.data,
      })),
    );
  }

  if (history.length === 0) {
    await db
      .update(conversations)
      .set({
        title: titleFrom(userMessage || pending[0]?.name || "New chat"),
        updatedAt: new Date(),
      })
      .where(eq(conversations.id, conversationId));
  }

  const memoryBlock = gem.memory
    ? `\n\n## What you already know about him\n\n${gem.memory}`
    : `\n\n## What you already know about him\n\nNothing yet. Use the remember tool when something is worth keeping.`;

  const systemPrompt = `${spec.systemPrompt}\n\n---\n\n## This gem: ${gem.label}\n\n${gem.instructions ?? ""}${memoryBlock}`;

  const actions: string[] = [];
  let poolChanged = false;
  let reply = "";

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await anthropic().messages.create({
        model: AGENT_MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: [
          { type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } },
          { type: "text", text: context },
        ],
        tools: [...SPECIALIST_TOOLS, REMEMBER],
        messages: thread,
      });

      if (response.stop_reason === "refusal") {
        reply = "I can't help with that one.";
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
        reply = text;
        break;
      }

      thread.push({ role: "assistant", content: response.content });
      reply = text || reply;

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolUses) {
        try {
          let out: string;

          if (call.name === "emit_task") {
            const parsed = emitTaskInput.parse(call.input);
            const id = `${gem.key}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
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
              sourceRef: `gem:${gem.key}`,
            });
            poolChanged = true;
            out = `Added "${parsed.title}".`;
            actions.push(out);
          } else if (call.name === "log_metric") {
            const parsed = logMetricInput.parse(call.input);
            await db.insert(metrics).values({
              onDate: parsed.onDate ?? date,
              kind: parsed.kind,
              value: parsed.value,
              unit: parsed.unit ?? null,
            });
            out = `Logged ${parsed.kind} ${parsed.value}${parsed.unit ?? ""}.`;
            actions.push(out);
          } else if (call.name === "close_task") {
            const parsed = closeTaskInput.parse(call.input);
            const updated = await db
              .update(tasks)
              .set({ status: parsed.status })
              .where(eq(tasks.id, parsed.taskId))
              .returning({ title: tasks.title });
            poolChanged = true;
            out = updated[0] ? `Marked "${updated[0].title}" ${parsed.status}.` : "No such task.";
            actions.push(out);
          } else if (call.name === "remember") {
            const parsed = rememberInput.parse(call.input);
            const next = gem.memory ? `${gem.memory}\n- ${parsed.note}` : `- ${parsed.note}`;
            await db.update(gems).set({ memory: next }).where(eq(gems.id, gem.id));
            gem.memory = next;
            out = "Saved.";
            actions.push(`Remembered: ${parsed.note}`);
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

      thread.push({ role: "user", content: results });
    }
  } catch (error) {
    throw new Error(describeApiError(error));
  }

  if (reply) {
    await db.insert(messages).values({
      conversationId,
      role: "assistant",
      content: reply,
      actions: actions.length > 0 ? actions : null,
    });
  }
  await db.update(conversations).set({ updatedAt: new Date() }).where(eq(conversations.id, conversationId));

  if (poolChanged) await replan(date);

  return { text: reply, actions, replanned: poolChanged };
}

/**
 * Ensure the roster exists, without disturbing memory already accumulated.
 *
 * The brief is refreshed on every sync so an edit to the prompt reaches an
 * existing gem, but `memory` is never written here — that belongs to the gem,
 * not to the seed.
 */
export async function syncGems(seeds: GemSeed[]): Promise<void> {
  for (const seed of seeds) {
    const existing = await db.select().from(gems).where(eq(gems.key, seed.key)).limit(1);
    const row = {
      key: seed.key,
      label: seed.label,
      blurb: seed.blurb,
      category: seed.category,
      domain: seed.domain,
      agent: seed.agent,
      courseCode: seed.courseCode ?? null,
      instructions: seed.instructions,
      sortOrder: seed.sortOrder,
    };

    if (existing[0]) {
      await db.update(gems).set({ ...row, active: true }).where(eq(gems.key, seed.key));
    } else {
      await db.insert(gems).values(row);
    }
  }

  // A dropped class should stop cluttering the sidebar, but its conversations
  // are still his — hide the gem rather than deleting anything.
  await db
    .update(gems)
    .set({ active: false })
    .where(notInArray(gems.key, seeds.map((s) => s.key)));
}

/** The gem's most recent open chat, or a fresh one if it has none. */
export async function ensureConversation(gemId: number): Promise<number> {
  const open = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.gemId, gemId), eq(conversations.archived, false)))
    .orderBy(asc(conversations.updatedAt));

  const latest = open[open.length - 1];
  if (latest) return latest.id;

  const created = await db.insert(conversations).values({ gemId }).returning({ id: conversations.id });
  const id = created[0]?.id;
  if (!id) throw new Error("Could not start a conversation.");
  return id;
}

/**
 * Put what the phone did into the gem's own thread.
 *
 * A capture that only writes tasks leaves the hub blind to it: you photograph
 * a worksheet at lunch, then that evening the tutor asks what the assignment
 * is. Writing the trace here means the next conversation opens already
 * knowing.
 */
export async function recordCapture(
  gemKey: string,
  prompt: string,
  summary: string,
  photo?: PendingFile,
): Promise<void> {
  const gem = (await db.select().from(gems).where(eq(gems.key, gemKey)).limit(1))[0];
  if (!gem) return;

  const conversationId = await ensureConversation(gem.id);
  const existing = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .limit(1);

  const asked = await db
    .insert(messages)
    .values({ conversationId, role: "user", content: prompt })
    .returning({ id: messages.id });

  const messageId = asked[0]?.id;
  if (messageId && photo) {
    await db.insert(attachments).values({
      messageId,
      name: photo.name,
      mediaType: photo.mediaType,
      bytes: Math.round((photo.data.length * 3) / 4),
      data: photo.data,
    });
  }

  await db.insert(messages).values({ conversationId, role: "assistant", content: summary });

  await db
    .update(conversations)
    .set({
      updatedAt: new Date(),
      ...(existing.length === 0 ? { title: titleFrom(prompt) } : {}),
    })
    .where(eq(conversations.id, conversationId));
}
