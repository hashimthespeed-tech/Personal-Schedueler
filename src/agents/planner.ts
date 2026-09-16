/**
 * The scheduler agent.
 *
 * Nobody owned the week. Specialists emitted whatever occurred to them in
 * whatever conversation happened to be open, the solver packed whatever was in
 * the pool, and no one ever asked "what does this week actually need to
 * contain?". The result was a calendar of two weigh-ins and four lifts and no
 * schoolwork at all, because nobody had told the tutor anything.
 *
 * So this runs once a week and asks each specialist two questions:
 *
 *   1. What does he need to do this week?
 *   2. What do you not know that is stopping you planning it properly?
 *
 * The first goes into the task pool. The second is the part that matters: an
 * unanswered need becomes a real block on his calendar — a few minutes to go
 * and tell that gem what it is missing. The system schedules its own repair
 * rather than quietly guessing, which is what produced the mess above.
 *
 * Each specialist gets ONE bounded turn, not a conversation. Four calls, not
 * forty.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db/index";
import { completions, needs, planProposals, tasks } from "@/db/schema";
import { anthropic, AGENT_MODEL, describeApiError } from "./client";
import { EMIT_TASK, DECLARE_NEED, CLOSE_TASK, emitTaskInput, declareNeedInput, closeTaskInput } from "./tools";
import { SPECIALISTS, SPECIALIST_NAMES, type SpecialistName } from "./specialists";
import { buildContext, today } from "./context";
import { writeNeed, writeTask } from "./task-writer";
import { replan } from "@/core/replan";
import type { IsoDate } from "@/core/types";

/** Which gem a specialist's questions should be answered in. */
const GEM_FOR: Record<SpecialistName, string> = {
  coach: "coach",
  tutor: "school-general",
  ustadh: "ustadh",
  builder: "ai-projects",
};

/** So a briefing is coloured as the thing it is about. */
const DOMAIN_FOR: Record<SpecialistName, "physique" | "school" | "deen" | "ai"> = {
  coach: "physique",
  tutor: "school",
  ustadh: "deen",
  builder: "ai",
};

const MAX_TURNS = 2;

export interface PlanReport {
  agent: SpecialistName;
  note: string;
  added: number;
  asked: number;
}

export interface WeeklyPlan {
  proposalId: number;
  weekStart: IsoDate;
  summary: string;
  reports: PlanReport[];
  blocks: number;
  notFitting: string[];
}

/**
 * The day the plan actually starts from.
 *
 * Not the Monday of the calendar week — the solver's horizon runs seven days
 * from today, so labelling a Wednesday re-plan "week of Monday the 14th" names
 * two days that have already been lived. Planned on a weekend, it rolls to the
 * Monday, because that is the week he is thinking about.
 */
export function planStartFor(date: IsoDate): IsoDate {
  const d = DateTime.fromISO(date);
  if (d.weekday < 6) return date;
  const monday = d.startOf("week").plus({ weeks: 1 }).toISODate();
  if (!monday) throw new Error(`Cannot resolve the week after ${date}`);
  return monday;
}

/** What he actually did last week, so the plan is not written blind. */
async function lastWeekReview(date: IsoDate): Promise<string> {
  const since = DateTime.fromISO(date).minus({ days: 7 }).toISODate();
  if (!since) return "";

  const done = await db
    .select()
    .from(completions)
    .where(gte(completions.onDate, since))
    .orderBy(desc(completions.onDate));

  if (done.length === 0) {
    return "Nothing was logged as done or skipped in the last seven days. Either he did not use the app or the plan did not survive contact with his week. Plan smaller.";
  }

  const finished = done.filter((c) => !c.skipped);
  const skipped = done.filter((c) => c.skipped);

  const lines = [`Last seven days: ${finished.length} done, ${skipped.length} skipped.`];
  if (skipped.length > 0) {
    const names = [...new Set(skipped.map((c) => c.title))].slice(0, 8);
    lines.push(`Skipped: ${names.join("; ")}.`);
    lines.push("Something skipped repeatedly is not a discipline problem, it is a planning problem. Make it smaller, move it, or drop it.");
  }
  return lines.join("\n");
}

function briefFor(agent: SpecialistName, weekStart: IsoDate, review: string): string {
  const spec = SPECIALISTS[agent];
  return `The planner is building the week beginning ${weekStart}. You are being asked
directly, not by him — he is not reading this, so do not address him and do not
ask him anything in your reply.

Two jobs, in this order.

1. Put this week's ${spec.label.toLowerCase()} work into the pool with emit_task.
   Reuse the key of anything already there rather than adding a second copy of
   it. Give every task its steps. If the right answer is that nothing new is
   needed this week, emit nothing and say so.

2. Anything you cannot plan properly because you were never told it — use
   declare_need. This is the important half. He will be given a few minutes on
   the calendar to come and answer you, so ask the questions that would
   actually change what you plan. Do not guess around a gap.

${review}

Then write two or three sentences for the planner: what you put in, what you are
holding back and why. Plain sentences, no headings, no bold.`;
}

/** One bounded turn with one specialist. */
async function poll(agent: SpecialistName, weekStart: IsoDate, date: IsoDate, review: string): Promise<PlanReport> {
  const spec = SPECIALISTS[agent];
  const context = await buildContext(agent, date);
  const thread: Anthropic.MessageParam[] = [{ role: "user", content: briefFor(agent, weekStart, review) }];

  let note = "";
  let added = 0;
  let asked = 0;

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await anthropic().messages.create({
      model: AGENT_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: [
        { type: "text", text: spec.systemPrompt, cache_control: { type: "ephemeral" } },
        { type: "text", text: context },
      ],
      tools: [EMIT_TASK, DECLARE_NEED, CLOSE_TASK],
      messages: thread,
    });

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    const calls = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    if (text) note = text;
    if (calls.length === 0) break;

    thread.push({ role: "assistant", content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const call of calls) {
      try {
        let out: string;
        if (call.name === "emit_task") {
          const parsed = emitTaskInput.parse(call.input);
          const written = await writeTask(parsed, agent, `planner:${weekStart}`);
          if (written.created) added += 1;
          out = written.message;
        } else if (call.name === "declare_need") {
          const parsed = declareNeedInput.parse(call.input);
          const written = await writeNeed(parsed, agent, GEM_FOR[agent]);
          if (written.created) asked += 1;
          out = written.message;
        } else if (call.name === "close_task") {
          const parsed = closeTaskInput.parse(call.input);
          const updated = await db
            .update(tasks)
            .set({ status: parsed.status })
            .where(eq(tasks.id, parsed.taskId))
            .returning({ title: tasks.title });
          out = updated[0] ? `Closed "${updated[0].title}".` : "No such task.";
        } else {
          out = `Unknown tool ${call.name}.`;
        }
        results.push({ type: "tool_result", tool_use_id: call.id, content: out });
      } catch (error) {
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: `Failed: ${error instanceof Error ? error.message : String(error)}`,
          is_error: true,
        });
      }
    }

    thread.push({ role: "user", content: results });
  }

  return { agent, note: note || "No comment.", added, asked };
}

/**
 * Turn open questions into time on the calendar.
 *
 * One block per gem rather than one per question: four separate two-minute
 * appointments to answer four questions is worse than one ten-minute sitting,
 * and it is the sitting he will actually do.
 */
async function scheduleBriefings(): Promise<number> {
  const open = await db.select().from(needs).where(isNull(needs.resolvedAt));
  if (open.length === 0) {
    await db
      .delete(tasks)
      .where(and(eq(tasks.sourceAgent, "system"), sql`${tasks.taskKey} like 'briefing-%'`));
    return 0;
  }

  const byGem = new Map<string, typeof open>();
  for (const need of open) {
    const key = need.gemKey ?? need.agent;
    byGem.set(key, [...(byGem.get(key) ?? []), need]);
  }

  // drop briefings whose questions have all been answered
  const live = new Set([...byGem.keys()].map((g) => `briefing-${g}`));
  const stale = await db
    .select({ id: tasks.id, taskKey: tasks.taskKey })
    .from(tasks)
    .where(and(eq(tasks.sourceAgent, "system"), sql`${tasks.taskKey} like 'briefing-%'`));
  for (const row of stale) {
    if (row.taskKey && !live.has(row.taskKey)) {
      await db.delete(tasks).where(eq(tasks.id, row.id));
    }
  }

  for (const [gemKey, list] of byGem) {
    const urgent = Math.min(...list.map((n) => n.urgency));
    const agent = list[0]!.agent as SpecialistName;
    const label = SPECIALISTS[agent]?.label ?? gemKey;

    await writeTask(
      {
        key: `briefing-${gemKey}`,
        title: `Tell ${label} what it's missing`,
        domain: DOMAIN_FOR[agent] ?? "school",
        durationMin: Math.min(30, 5 + list.length * 4),
        minChunkMin: null,
        deadline: null,
        earliestTime: null,
        latestTime: null,
        energy: "low",
        priority: urgent === 1 ? 1 : 2,
        dayPart: "evening",
        recurrence: "once",
        allowedWeekdays: null,
        spacingHours: null,
        spacingGroup: null,
        movementTags: null,
        notes: `Open ${label} in the hub and answer these. It cannot plan properly until you do.`,
        steps: list.map((n) => n.question),
        oncePerDay: null,
        goalId: null,
      },
      "system",
      `briefing:${gemKey}`,
    );
  }

  return open.length;
}

/**
 * Planning runs in three phases, one request each.
 *
 * It used to be a single call that polled all four specialists in turn. Each
 * poll is a full Opus conversation with adaptive thinking, so four of them in
 * one request is a couple of minutes on a good day — comfortably past the 300
 * second ceiling a serverless function gets, and what that looks like from the
 * outside is a button that does nothing.
 *
 * So the client asks for one agent at a time. Each request is one conversation,
 * well inside the limit, and it can say whose turn it is while it waits.
 */

export interface PlanStart {
  proposalId: number;
  weekStart: IsoDate;
  agents: SpecialistName[];
}

/** Open a draft for this week, discarding any half-finished one. */
export async function beginPlan(date: IsoDate = today()): Promise<PlanStart> {
  const weekStart = planStartFor(date);

  await db
    .update(planProposals)
    .set({ status: "superseded" })
    .where(
      and(
        eq(planProposals.weekStart, weekStart),
        inArray(planProposals.status, ["drafting", "proposed"]),
      ),
    );

  const created = await db
    .insert(planProposals)
    .values({
      weekStart,
      status: "drafting",
      summary: "Asking everyone what the week needs…",
      reports: {},
      notFitting: [],
    })
    .returning({ id: planProposals.id });

  const id = created[0]?.id;
  if (!id) throw new Error("Could not start a plan.");

  return { proposalId: id, weekStart, agents: [...SPECIALIST_NAMES] };
}

/** One specialist's turn. Safe to retry: the task keys make it idempotent. */
export async function pollAgent(
  proposalId: number,
  agent: SpecialistName,
  date: IsoDate = today(),
): Promise<PlanReport> {
  const proposal = (
    await db.select().from(planProposals).where(eq(planProposals.id, proposalId)).limit(1)
  )[0];
  if (!proposal) throw new Error("No such plan.");

  const review = await lastWeekReview(date);

  let report: PlanReport;
  try {
    report = await poll(agent, proposal.weekStart, date, review);
  } catch (error) {
    throw new Error(describeApiError(error));
  }

  await db
    .update(planProposals)
    .set({ reports: { ...(proposal.reports ?? {}), [agent]: report.note } })
    .where(eq(planProposals.id, proposalId));

  return report;
}

/** Turn what everyone said into a week. */
export async function finishPlan(
  proposalId: number,
  reports: PlanReport[],
  date: IsoDate = today(),
): Promise<WeeklyPlan> {
  const proposal = (
    await db.select().from(planProposals).where(eq(planProposals.id, proposalId)).limit(1)
  )[0];
  if (!proposal) throw new Error("No such plan.");

  const pending = await scheduleBriefings();
  const solved = await replan(date);

  const added = reports.reduce((n, r) => n + r.added, 0);
  const asked = reports.reduce((n, r) => n + r.asked, 0);

  const summary = [
    `${solved.blocks.length} blocks across the week, ${added} new task${added === 1 ? "" : "s"}.`,
    asked > 0
      ? `${asked} thing${asked === 1 ? "" : "s"} nobody could plan around — there is time on the calendar to answer ${asked === 1 ? "it" : "them"}.`
      : pending > 0
        ? `${pending} open question${pending === 1 ? "" : "s"} still waiting to be answered.`
        : `Nothing is blocked on missing information.`,
    solved.unplaced.length > 0
      ? `${solved.unplaced.length} did not fit. That is the week being honest with you, not a bug.`
      : `Everything fitted.`,
  ].join(" ");

  const notFitting = solved.unplaced.map((u) => `${u.title} — ${u.detail}`);

  await db
    .update(planProposals)
    .set({ status: "proposed", summary, notFitting, planVersion: solved.planVersion })
    .where(eq(planProposals.id, proposalId));

  return {
    proposalId,
    weekStart: proposal.weekStart,
    summary,
    reports,
    blocks: solved.blocks.length,
    notFitting,
  };
}

/** Mark a need answered, and take its briefing off the calendar when the last one goes. */
export async function resolveNeed(id: number): Promise<void> {
  await db.update(needs).set({ resolvedAt: new Date() }).where(eq(needs.id, id));
  await scheduleBriefings();
}

export async function decideProposal(id: number, status: "approved" | "rejected"): Promise<void> {
  await db
    .update(planProposals)
    .set({ status, decidedAt: new Date() })
    .where(eq(planProposals.id, id));
}
