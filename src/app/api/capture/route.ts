import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/index";
import { courses } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { runCapture } from "@/agents/capture";
import { captureCategories, findTarget } from "@/data/capture-targets";

export const maxDuration = 300;

const body = z.object({
  targetId: z.string(),
  /** base64 without the data: prefix */
  image: z.string().min(100),
  mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  note: z.string().max(500).default(""),
});

/** The picker tree, with subjects read from the courses table. */
export async function GET() {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const courseRows = await db.select().from(courses).orderBy(courses.period);
  return NextResponse.json({ ok: true, categories: captureCategories(courseRows) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const { targetId, image, mediaType, note } = parsed.data;
  const courseRows = await db.select().from(courses).orderBy(courses.period);
  const target = findTarget(captureCategories(courseRows), targetId);

  if (!target) {
    return NextResponse.json({ ok: false, error: "Unknown capture target." }, { status: 404 });
  }

  try {
    const result = await runCapture(target, image, mediaType, note);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Capture failed." },
      { status: 500 },
    );
  }
}
