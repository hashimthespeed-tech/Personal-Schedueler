import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import { assignments, courses } from "@/db/schema";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const add = z.object({
  action: z.literal("add"),
  courseId: z.number().int(),
  title: z.string().min(1).max(200),
  kind: z.enum(["homework", "test", "project", "reading"]),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  estimatedMin: z.number().int().min(5).max(600),
  notes: z.string().max(1000).nullable().optional(),
});

const close = z.object({
  action: z.literal("close"),
  id: z.number().int(),
  status: z.enum(["open", "done"]),
});

const body = z.union([add, close]);

/** The courses to file against, and everything still open. */
export async function GET() {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const [courseRows, open] = await Promise.all([
    db.select().from(courses).orderBy(courses.period),
    db.select().from(assignments).where(eq(assignments.status, "open")).orderBy(asc(assignments.dueDate)),
  ]);

  return NextResponse.json({
    ok: true,
    courses: courseRows
      .filter((c) => c.code !== "FREE" && c.domain !== "physique")
      .map((c) => ({ id: c.id, code: c.code, name: c.name, period: c.period })),
    assignments: open.map((a) => ({
      id: a.id,
      courseId: a.courseId,
      title: a.title,
      kind: a.kind,
      dueDate: a.dueDate,
      estimatedMin: a.estimatedMin,
    })),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: parsed.error.issues[0]?.message ?? "Bad request." },
      { status: 400 },
    );
  }

  if (parsed.data.action === "close") {
    await db
      .update(assignments)
      .set({ status: parsed.data.status })
      .where(eq(assignments.id, parsed.data.id));
    return NextResponse.json({ ok: true });
  }

  const { courseId, title, kind, dueDate, estimatedMin, notes } = parsed.data;

  const course = (await db.select().from(courses).where(eq(courses.id, courseId)).limit(1))[0];
  if (!course) return NextResponse.json({ ok: false, error: "No such course." }, { status: 404 });

  // don't file the same thing twice when he taps add on a flaky connection
  const twin = (
    await db
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.courseId, courseId),
          eq(assignments.title, title),
          eq(assignments.status, "open"),
        ),
      )
      .limit(1)
  )[0];

  if (twin) return NextResponse.json({ ok: true, id: twin.id, duplicate: true });

  const created = await db
    .insert(assignments)
    .values({ courseId, title, kind, dueDate, estimatedMin, notes: notes ?? null })
    .returning({ id: assignments.id });

  return NextResponse.json({ ok: true, id: created[0]?.id });
}
