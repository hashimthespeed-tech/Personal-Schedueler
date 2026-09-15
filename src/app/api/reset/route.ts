import { NextResponse } from "next/server";
import { and, eq, inArray, gte } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import { agentThreads, blocks, tasks, unplaced } from "@/db/schema";
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
      if (agent) {
        const n = await db.delete(agentThreads).where(eq(agentThreads.agent, agent)).returning({ id: agentThreads.id });
        cleared = `Cleared ${n.length} messages from the ${agent} conversation.`;
      } else {
        const n = await db.delete(agentThreads).returning({ id: agentThreads.id });
        cleared = `Cleared ${n.length} messages across every conversation.`;
      }
      break;
    }

    case "everything": {
      const n = await db.delete(tasks).returning({ id: tasks.id });
      await db.delete(blocks);
      await db.delete(unplaced);
      await db.delete(agentThreads);
      removedTasks = n.length;
      cleared = `Deleted ${n.length} tasks, the schedule, and every conversation. Your completion history is untouched.`;
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

  const [allTasks, allBlocks, threads] = await Promise.all([
    db.select().from(tasks),
    db.select().from(blocks),
    db.select().from(agentThreads),
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
