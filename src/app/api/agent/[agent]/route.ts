import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { runSpecialist } from "@/agents/run";
import { isSpecialist } from "@/agents/specialists";

// Vercel caps this at 60s on Hobby and 300s on Pro. An Opus 5 turn with
// adaptive thinking and a tool loop usually lands well inside 60s; raise it
// if you move to Pro and a long tool loop ever gets cut off.
export const maxDuration = 60;

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
