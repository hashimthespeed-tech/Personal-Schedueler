import { NextResponse } from "next/server";
import { and, eq, inArray, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import {
  agentThreads, attachments, blocks, conversations, gems, messages, needs,
  planProposals, tasks, unplaced,
} from "@/db/schema";
import { getSession } from "@/lib/auth";
import { replan } from "@/core/replan";
import { today } from "@/agents/context";

/**
 * Deleting things, at four different scopes.
 *
 * Completions are never touched. They are the record of what actually
 * happened; clearing a plan should not rewrite history, and the stats page
 * would silently lose months if it did.
 */
const body = z.object({
  scope: z.enum(["schedule", "tasks", "domain", "agent", "task", "threads", "everything"]),
  domain: z.string().optional(),
  agent: z.string().optional(),
  taskId: z.string().optional(),
  /** re-solve afterwards so the schedule matches the new task pool */
  replanAfter: z.boolean().default(true),
});

/**
 * Wipe hub chats, optionally for one specialist's gems only.
 *
 * Attachments go with them — a photograph whose message is gone is a row
 * nothing can reach, and they are the largest thing in the database.
 * Gem memory is deliberately kept: it is what the gem learned about him, not
 * schedule clutter, and losing it to a task reset would be a nasty surprise.
 */
async function clearConversations(agent: string | null): Promise<number> {
  const rows = agent
    ? await db
        .select({ id: conversations.id })
        .from(conversations)
        .innerJoin(gems, eq(conversations.gemId, gems.id))
        .where(eq(gems.agent, agent))
    : await db.select({ id: conversations.id }).from(conversations);

  if (rows.length === 0) return 0;
  const ids = rows.map((r) => r.id);

  const doomed = await db
    .select({ id: messages.id })
    .from(messages)
    .where(inArray(messages.conversationId, ids));

  if (doomed.length > 0) {
    await db.delete(attachments).where(inArray(attachments.messageId, doomed.map((m) => m.id)));
  }
  await db.delete(messages).where(inArray(messages.conversationId, ids));
  await db.delete(conversations).where(inArray(conversations.id, ids));

  return doomed.length;
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }
  const { scope, domain, agent, taskId, replanAfter } = parsed.data;

  let removedTasks = 0;
  let cleared = "";

  switch (scope) {
    case "schedule": {
      // wipe the placement, keep the work
      const n = await db.delete(blocks).returning({ id: blocks.id });
      await db.delete(unplaced);
      cleared = `Cleared ${n.length} scheduled blocks. The tasks are still there.`;
      break;
    }

    case "tasks": {
      const n = await db.delete(tasks).returning({ id: tasks.id });
      await db.delete(blocks);
      await db.delete(unplaced);
      removedTasks = n.length;
      cleared = `Deleted all ${n.length} tasks and the schedule.`;
      break;
    }

    case "domain": {
      if (!domain) return NextResponse.json({ ok: false, error: "No domain given." }, { status: 400 });
      const n = await db.delete(tasks).where(eq(tasks.domain, domain)).returning({ id: tasks.id });
      removedTasks = n.length;
      cleared = `Deleted ${n.length} ${domain} tasks.`;
      break;
    }

    case "agent": {
      if (!agent) return NextResponse.json({ ok: false, error: "No agent given." }, { status: 400 });
      const n = await db.delete(tasks).where(eq(tasks.sourceAgent, agent)).returning({ id: tasks.id });
      removedTasks = n.length;
      cleared = `Deleted ${n.length} tasks from the ${agent}.`;
      break;
    }

    case "task": {
      if (!taskId) return NextResponse.json({ ok: false, error: "No task given." }, { status: 400 });
      const n = await db.delete(tasks).where(eq(tasks.id, taskId)).returning({ title: tasks.title });
      removedTasks = n.length;
      cleared = n[0] ? `Deleted "${n[0].title}".` : "No such task.";
      break;
    }

    case "threads": {
      // the hub writes conversations/messages; agent_threads is the old store
      const n = await clearConversations(agent ?? null);
      await db.delete(agentThreads);
      cleared = agent
        ? `Cleared ${n} messages from the ${agent} gems. What they remember is kept.`
        : `Cleared ${n} messages across every gem. What they remember is kept.`;
      break;
    }

    case "everything": {
      const n = await db.delete(tasks).returning({ id: tasks.id });
      await db.delete(blocks);
      await db.delete(unplaced);
      await db.delete(planProposals);
      // open questions are re-derivable: the agents declare them again on the
      // next plan, so clearing them is a clean slate rather than lost data
      await db.delete(needs);
      const messageCount = await clearConversations(null);
      await db.delete(agentThreads);
      removedTasks = n.length;
      cleared =
        `Deleted ${n.length} tasks, the schedule, ${messageCount} messages and the weekly plan. ` +
        `Your completion history, your goals and what each gem remembers are untouched.`;
      break;
    }
  }

  let replanned = false;
  if (replanAfter && scope !== "schedule" && scope !== "threads") {
    await replan(today());
    replanned = true;
  }

  return NextResponse.json({ ok: true, cleared, removedTasks, replanned });
}

/** Counts, so the UI can say what a given button would actually remove. */
export async function GET() {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const [allTasks, allBlocks, threads, openNeeds] = await Promise.all([
    db.select().from(tasks),
    db.select().from(blocks),
    // the hub's messages, not agent_threads — that count never moved
    db.select({ id: messages.id }).from(messages),
    db.select({ id: needs.id }).from(needs).where(isNull(needs.resolvedAt)),
  ]);

  const byDomain: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  for (const t of allTasks) {
    byDomain[t.domain] = (byDomain[t.domain] ?? 0) + 1;
    byAgent[t.sourceAgent] = (byAgent[t.sourceAgent] ?? 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    tasks: allTasks.length,
    blocks: allBlocks.length,
    threads: threads.length,
    openNeeds: openNeeds.length,
    byDomain,
    byAgent,
    list: allTasks.map((t) => ({
      id: t.id,
      title: t.title,
      domain: t.domain,
      agent: t.sourceAgent,
      durationMin: t.durationMin,
      recurrence: t.recurrence,
      dayPart: t.dayPart,
      hasSteps: Boolean(t.steps?.length),
    })),
  });
}
