import { NextResponse } from "next/server";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import { blocks, needs, planProposals } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { decideProposal, planStartFor, planWeek, resolveNeed } from "@/agents/planner";
import { today } from "@/agents/context";

export const maxDuration = 300;

const body = z.union([
  z.object({ action: z.literal("plan") }),
  z.object({ action: z.literal("decide"), id: z.number().int(), status: z.enum(["approved", "rejected"]) }),
  z.object({ action: z.literal("resolve"), id: z.number().int() }),
]);

/** The current proposal, plus what is still waiting to be answered. */
export async function GET() {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const weekStart = planStartFor(today());
  const latest = (
    await db
      .select()
      .from(planProposals)
      .orderBy(desc(planProposals.createdAt))
      .limit(1)
  )[0];

  const open = await db.select().from(needs).where(isNull(needs.resolvedAt)).orderBy(needs.urgency);
  const planned = latest
    ? await db.select().from(blocks).where(eq(blocks.planVersion, latest.planVersion ?? -1)).orderBy(blocks.onDate, blocks.startMin)
    : [];

  return NextResponse.json({
    ok: true,
    weekStart,
    proposal: latest ?? null,
    needs: open.map((n) => ({
      id: n.id,
      agent: n.agent,
      gemKey: n.gemKey,
      question: n.question,
      why: n.why,
      urgency: n.urgency,
    })),
    blocks: planned.map((b) => ({
      id: b.id,
      title: b.title,
      domain: b.domain,
      onDate: b.onDate,
      startMin: b.startMin,
      endMin: b.endMin,
      steps: b.steps,
    })),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });

  try {
    if (parsed.data.action === "plan") {
      const plan = await planWeek();
      return NextResponse.json({ ok: true, plan });
    }
    if (parsed.data.action === "decide") {
      await decideProposal(parsed.data.id, parsed.data.status);
      return NextResponse.json({ ok: true });
    }
    await resolveNeed(parsed.data.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Failed." },
      { status: 500 },
    );
  }
}
