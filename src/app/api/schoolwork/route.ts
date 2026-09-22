import { NextResponse } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "@/db/index";
import { assignments, courses, scheduledTasks } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { today } from "@/core/clock";
import { LA_MESA } from "@/core/prayer";
import { buildDayFrame } from "@/core/day-frame";
import { planSchoolwork, recommendWorkdays, suggestWorkdays, type PlanningDay } from "@/core/schoolwork";

export const dynamic = "force-dynamic";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const fields = {
  courseId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["homework", "reading", "project", "test"]),
  estimatedMin: z.number().int().min(15).max(600).refine((value) => value % 5 === 0),
  dueDate: iso,
};
const body = z.union([
  z.object({ action: z.literal("options"), ...fields }),
  z.object({ action: z.literal("preview"), ...fields, selectedDates: z.array(iso).min(1).max(30) }),
  z.object({ action: z.literal("approve"), ...fields, selectedDates: z.array(iso).min(1).max(30), chosen: z.unknown() }),
]);

function error(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function validDate(value: string) {
  const date = DateTime.fromISO(value);
  return date.isValid && date.toISODate() === value;
}

function minuteNow() {
  const local = DateTime.now().setZone(LA_MESA.timezone);
  return local.hour * 60 + local.minute;
}

async function planningDays(dueDate: string): Promise<PlanningDay[]> {
  const start = DateTime.fromISO(today());
  const end = DateTime.min(DateTime.fromISO(dueDate).minus({ days: 1 }), start.plus({ days: 29 }));
  const dates: string[] = [];
  for (let day = start; day <= end; day = day.plus({ days: 1 })) dates.push(day.toISODate()!);
  const existing = dates.length ? await db.select().from(scheduledTasks).where(inArray(scheduledTasks.onDate, dates)) : [];

  return dates.map((date) => {
    const frame = buildDayFrame(date, { sleepMode: "current" });
    const taskBlocks = existing.filter((task) => task.onDate === date && task.startMin !== null &&
      (task.status === "planned" || task.status === "done"))
      .map((task) => ({ id: `task-${task.id}`, title: task.title, start: task.startMin!,
        end: task.startMin! + task.durationMin, policy: "fixed" as const }));
    return { template: { ...frame, blocks: [...frame.blocks, ...taskBlocks] },
      notBefore: date === today() ? Math.max(frame.wake, minuteNow()) : frame.wake };
  });
}

export async function GET() {
  const session = await getSession();
  if (!session.loggedIn) return error("Sign in first.", 401);
  const [courseRows, open, sessions] = await Promise.all([
    db.select().from(courses).orderBy(asc(courses.period)),
    db.select().from(assignments).where(eq(assignments.status, "open")).orderBy(asc(assignments.dueDate)),
    db.select().from(scheduledTasks),
  ]);
  return NextResponse.json({ ok: true,
    courses: courseRows.filter((course) => course.code !== "FREE" && course.domain !== "physique")
      .map((course) => ({ id: course.id, code: course.code, name: course.name })),
    assignments: open.map((assignment) => ({ id: assignment.id, title: assignment.title, kind: assignment.kind,
      courseId: assignment.courseId, dueDate: assignment.dueDate, estimatedMin: assignment.estimatedMin,
      sessions: sessions.filter((task) => task.assignmentId === assignment.id)
        .map((task) => ({ id: task.id, onDate: task.onDate, durationMin: task.durationMin,
          startMin: task.startMin, role: task.workRole, status: task.status })) })),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return error("Sign in first.", 401);
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid assignment.");
  const data = parsed.data;
  if (!validDate(data.dueDate) || data.dueDate <= today()) return error("Choose a future due date.");
  const [course] = await db.select().from(courses).where(eq(courses.id, data.courseId)).limit(1);
  if (!course) return error("Choose one of your courses.", 404);

  const days = await planningDays(data.dueDate);
  const kind = data.kind === "test" ? "test" : "assignment";
  if (data.action === "options") {
    return NextResponse.json({ ok: true,
      days: suggestWorkdays(days, data.dueDate),
      recommendedDates: recommendWorkdays(days, data.dueDate, data.estimatedMin, kind),
    });
  }

  const plan = planSchoolwork({ id: "new-assignment", title: data.title, kind,
    totalMin: data.estimatedMin, dueDate: data.dueDate, selectedDates: data.selectedDates }, days);
  if (data.action === "preview") return NextResponse.json({ ok: true, plan });
  if (!plan.ok || JSON.stringify(plan.sessions) !== JSON.stringify(data.chosen)) {
    return error("The available times changed. Review the plan again.", 409);
  }

  const [duplicate] = await db.select({ id: assignments.id }).from(assignments)
    .where(and(eq(assignments.courseId, data.courseId), eq(assignments.title, data.title),
      eq(assignments.dueDate, data.dueDate), eq(assignments.status, "open"))).limit(1);
  if (duplicate) return error("This assignment is already in your list.", 409);

  const assignmentId = await db.transaction(async (tx) => {
    const [created] = await tx.insert(assignments).values({ courseId: data.courseId, title: data.title,
      kind: data.kind, dueDate: data.dueDate, estimatedMin: data.estimatedMin, status: "open" })
      .returning({ id: assignments.id });
    if (!created) throw new Error("Assignment insert returned no id.");
    await tx.insert(scheduledTasks).values(plan.sessions.map((session) => ({
      title: session.role === "refresher" ? `${data.title} · refresher` : data.title,
      onDate: session.date, startMin: session.placement.start, durationMin: session.minutes,
      kind: "school", status: "planned", dueDate: data.dueDate,
      assignmentId: created.id, workRole: session.role, approvedCosts: session.placement.costs,
    })));
    return created.id;
  });
  return NextResponse.json({ ok: true, id: assignmentId });
}
