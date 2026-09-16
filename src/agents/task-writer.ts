/**
 * The one place a task enters the pool.
 *
 * Every specialist went through its own copy of this insert, and each copy
 * trusted the model not to emit the same work twice. It did anyway: asked to
 * plan the week on two separate days, the coach produced "Lift A — squat /
 * bench / row" and "Lift A - full body", plus two weigh-ins and two shops,
 * having been shown the existing pool both times and told not to.
 *
 * The lesson is that identity cannot live in a prompt. It lives in a key.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/db/index";
import { needs, tasks } from "@/db/schema";
import { hm } from "@/core/types";
import type { EmitTaskInput, DeclareNeedInput } from "./tools";

export interface WriteResult {
  /** what to hand back to the model */
  message: string;
  created: boolean;
}

/**
 * A second net under the key: the same title emitted under two keys.
 *
 * Deliberately strict — the whole normalized title has to match, not a prefix
 * or most of the words. A looser rule would have caught "Food shop + batch
 * cook" and "Grocery shop + batch cook", but it would also have merged "Lift A"
 * into "Lift B", and silently overwriting one real task with a different one is
 * a worse failure than showing a duplicate. Reworded repeats are the key's job.
 */
export function titleStem(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .join(" ");
}

function rowFrom(input: EmitTaskInput, agent: string) {
  return {
    domain: input.domain,
    title: input.title,
    notes: input.notes ?? null,
    durationMin: input.durationMin,
    minChunkMin: input.minChunkMin ?? null,
    deadline: input.deadline ?? null,
    earliestTime: input.earliestTime ? hm(input.earliestTime) : null,
    latestTime: input.latestTime ? hm(input.latestTime) : null,
    energy: input.energy,
    priority: input.priority,
    dayPart: input.dayPart,
    recurrence: input.recurrence,
    oncePerDay: input.oncePerDay ?? false,
    steps: input.steps ?? null,
    goalId: input.goalId ?? null,
    allowedWeekdays: input.allowedWeekdays ?? null,
    movementTags: input.movementTags ?? null,
    spacingHours: input.spacingHours ?? null,
    spacingGroup: input.spacingGroup ?? null,
    sourceAgent: agent,
    taskKey: input.key,
    status: "open",
  };
}

/** Add the task, or update the one that already means this. */
export async function writeTask(
  input: EmitTaskInput,
  agent: string,
  sourceRef: string,
): Promise<WriteResult> {
  const row = rowFrom(input, agent);

  const byKey = (
    await db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.sourceAgent, agent), eq(tasks.taskKey, input.key)))
      .limit(1)
  )[0];

  if (byKey) {
    await db.update(tasks).set(row).where(eq(tasks.id, byKey.id));
    return { message: `Updated "${input.title}" (key ${input.key}).`, created: false };
  }

  const stem = titleStem(input.title);
  const siblings = await db
    .select({ id: tasks.id, title: tasks.title, taskKey: tasks.taskKey })
    .from(tasks)
    .where(and(eq(tasks.sourceAgent, agent), eq(tasks.status, "open")));

  const twin = siblings.find((t) => titleStem(t.title) === stem);
  if (twin) {
    await db.update(tasks).set(row).where(eq(tasks.id, twin.id));
    return {
      message:
        `"${twin.title}" was already in the pool and meant the same thing, so it was updated ` +
        `rather than duplicated. It now has key ${input.key}.`,
      created: false,
    };
  }

  await db.insert(tasks).values({
    ...row,
    id: `${agent}-${input.key}-${Date.now().toString(36)}`,
    sourceRef,
  });
  return { message: `Added "${input.title}".`, created: true };
}

/** Record a gap, unless that question is already waiting to be answered. */
export async function writeNeed(
  input: DeclareNeedInput,
  agent: string,
  gemKey: string | null,
): Promise<WriteResult> {
  const open = await db
    .select()
    .from(needs)
    .where(and(eq(needs.agent, agent), eq(needs.question, input.question)));

  const unresolved = open.find((n) => n.resolvedAt === null);
  if (unresolved) return { message: "Already asked; it is on his list.", created: false };

  await db.insert(needs).values({
    agent,
    gemKey,
    question: input.question,
    why: input.why,
    urgency: input.urgency,
  });
  return { message: `Noted. He will be asked: "${input.question}"`, created: true };
}
