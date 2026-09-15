import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { runSpecialist } from "@/agents/run";
import { isSpecialist } from "@/agents/specialists";

/**
 * 300s, which is what Hobby allows with Fluid compute (on by default for new
 * projects). This was 60 and that was simply wrong: a single Opus 5 turn with
 * adaptive thinking can take 30-60s on its own, and a tool loop makes several
 * of them, so the function was being killed mid-conversation and returning a
 * 504.
 *
 * If a deploy rejects this value, Fluid compute is off for the project —
 * Vercel dashboard, Settings, Functions.
 */
export const maxDuration = 300;

const body = z.object({ message: z.string().min(1).max(4000) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ agent: string }> },
) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const { agent } = await params;
  if (!isSpecialist(agent)) {
    return NextResponse.json({ ok: false, error: "Unknown agent." }, { status: 404 });
  }

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  try {
    const reply = await runSpecialist(agent, parsed.data.message);
    return NextResponse.json({ ok: true, ...reply });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Agent failed." },
      { status: 500 },
    );
  }
}
