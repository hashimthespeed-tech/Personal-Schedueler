import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { runCapture } from "@/agents/capture";
import { isSpecialist } from "@/agents/specialists";

export const maxDuration = 300;

const body = z.object({
  agent: z.string(),
  /** base64 without the data: prefix */
  image: z.string().min(100),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  note: z.string().max(500).default(""),
  kind: z.enum(["homework", "schedule", "note"]).default("homework"),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const { agent, image, mediaType, note, kind } = parsed.data;
  if (!isSpecialist(agent)) {
    return NextResponse.json({ ok: false, error: "Unknown agent." }, { status: 404 });
  }

  try {
    const result = await runCapture(agent, image, mediaType, note, kind);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Capture failed." },
      { status: 500 },
    );
  }
}
