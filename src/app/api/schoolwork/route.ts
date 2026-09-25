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
import { buildCustomSchoolworkTradeoff, customTradeoffDraft, planSchoolwork, proposeSchoolworkTradeoffs,
  recommendWorkdays, suggestWorkdays, type PlanningDay } from "@/core/schoolwork";
import { rebalanceAfterDeletion } from "@/core/rebalance";

export const dynamic = "force-dynamic";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const fields = {
  courseId: z.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  kind: z.enum(["homework", "reading", "project", "test", "short_test"]),
  estimatedMin: z.number().int().min(1).max(600),
  dueDate: iso,
};
const body = z.union([
  z.object({ action: z.literal("delete"), id: z.number().int().positive() }),
  z.object({ action: z.literal("options"), ...fields }),
  z.object({ action: z.literal("preview"), ...fields, selectedDates: z.array(iso).min(1).max(30) }),
  z.object({ action: z.literal("approve"), ...fields, selectedDates: z.array(iso).min(1).max(30),
    chosen: z.unknown().optional(), customAllocation: z.array(z.object({ sourceId: z.string().min(1).max(160),
      minutes: z.number().int().min(0).max(480) })).max(100).optional(), saveUnscheduled: z.boolean().optional() }),
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

function deletionNotBefore(date: string) {
  return date < today() ? 1440 : date === today() ? minuteNow() : 0;
}

async function planningDays(dueDate: string): Promise<PlanningDay[]> {
  const start = DateTime.fromISO(today());
  const end = DateTime.min(DateTime.fromISO(dueDate).minus({ days: 1 }), start.plus({ days: 29 }));
  const dates: string[] = [];
  for (let day = start; day <= end; day = day.plus({ days: 1 })) dates.push(day.toISODate()!);
  const existing = dates.length ? await db.select().from(scheduledTasks).where(inArray(scheduledTasks.onDate, dates)) : [];

  return dates.map((date) => {
    const frame = buildDayFrame(date, { sleepMode: "current", includeRoutineTradeoffs: true });
    const taskBlocks = existing.filter((task) => task.onDate === date && task.startMin !== null && task.status === "planned")
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
  if (data.action === "delete") {
    const result = await db.transaction(async (tx) => {
      const [source] = await tx.select().from(assignments).where(eq(assignments.id, data.id)).limit(1);
      if (!source) return null;
      const sessions = await tx.select().from(scheduledTasks)
        .where(eq(scheduledTasks.assignmentId, source.id));
      await tx.delete(scheduledTasks).where(eq(scheduledTasks.assignmentId, source.id));
      await tx.delete(assignments).where(eq(assignments.id, source.id));

      let rebalanced = 0;
      const ordered = [...sessions].sort((a, b) => a.onDate.localeCompare(b.onDate) ||
        (a.startMin ?? Number.MAX_SAFE_INTEGER) - (b.startMin ?? Number.MAX_SAFE_INTEGER));
      for (const removed of ordered) {
        const sameDay = await tx.select().from(scheduledTasks).where(eq(scheduledTasks.onDate, removed.onDate));
        const plan = rebalanceAfterDeletion(removed, sameDay, deletionNotBefore(removed.onDate));
        const byId = new Map(sameDay.map((task) => [task.id, task]));
        for (const update of plan.updates) {
          await tx.update(scheduledTasks).set({ startMin: update.startMin, durationMin: update.durationMin,
            approvedCosts: update.approvedCosts }).where(and(eq(scheduledTasks.id, update.id), eq(scheduledTasks.status, "planned")));
        }
        for (const split of plan.splits) {
          const original = byId.get(split.sourceId);
          if (!original) continue;
          await tx.insert(scheduledTasks).values({ title: original.title, onDate: original.onDate,
            durationMin: split.durationMin, startMin: split.startMin, dueDate: original.dueDate,
            kind: original.kind, status: "planned", approvedCosts: split.approvedCosts,
            assignmentId: original.assignmentId, workRole: original.workRole });
        }
        rebalanced += plan.updates.length + plan.splits.length;
      }
      return { id: source.id, deletedSessions: sessions.length, rebalanced };
    });
    if (!result) return error("Assignment was not found.", 404);
    return NextResponse.json({ ok: true, ...result });
  }
  if (!validDate(data.dueDate) || data.dueDate <= today()) return error("Choose a future due date.");
  const [course] = await db.select().from(courses).where(eq(courses.id, data.courseId)).limit(1);
  if (!course) return error("Choose one of your courses.", 404);

  const days = await planningDays(data.dueDate);
  const kind = data.kind === "test" ? "test" : data.kind === "short_test" ? "short-test" : "assignment";
  if (data.action === "options") {
    return NextResponse.json({ ok: true,
      days: suggestWorkdays(days, data.dueDate),
      recommendedDates: recommendWorkdays(days, data.dueDate, data.estimatedMin, kind),
    });
  }

  const plan = planSchoolwork({ id: "new-assignment", title: data.title, kind,
    totalMin: data.estimatedMin, dueDate: data.dueDate, selectedDates: data.selectedDates }, days);
  const tradeoffs = plan.ok ? [] : proposeSchoolworkTradeoffs({ id: "new-assignment", title: data.title, kind,
    totalMin: data.estimatedMin, dueDate: data.dueDate, selectedDates: data.selectedDates }, days);
  const customDraft = plan.ok ? null : customTradeoffDraft({ id: "new-assignment", title: data.title, kind,
    totalMin: data.estimatedMin, dueDate: data.dueDate, selectedDates: data.selectedDates }, days);
  if (data.action === "preview") return NextResponse.json({ ok: true, plan, tradeoffs, customDraft });
  const custom = data.customAllocation ? buildCustomSchoolworkTradeoff({ id: "new-assignment", title: data.title, kind,
    totalMin: data.estimatedMin, dueDate: data.dueDate, selectedDates: data.selectedDates }, days, data.customAllocation) : null;
  const chosenSessions = plan.ok && JSON.stringify(plan.sessions) === JSON.stringify(data.chosen) ? plan.sessions :
    tradeoffs.find((option) => JSON.stringify(option.sessions) === JSON.stringify(data.chosen))?.sessions ?? custom?.sessions;
  const unscheduledDate = [...data.selectedDates].sort().at(-1);
  const saveUnscheduled = data.saveUnscheduled === true && !plan.ok && !!unscheduledDate && unscheduledDate < data.dueDate;
  if (!chosenSessions && !saveUnscheduled) {
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
    await tx.insert(scheduledTasks).values(chosenSessions ? chosenSessions.map((session) => ({
        title: session.role === "refresher" ? `${data.title} · refresher` : data.title,
        onDate: session.date, startMin: session.placement.start, durationMin: session.minutes,
        kind: "school", status: "planned", dueDate: data.dueDate,
        assignmentId: created.id, workRole: session.role, approvedCosts: session.placement.costs,
      })) : [{ title: data.title, onDate: unscheduledDate!, startMin: null, durationMin: data.estimatedMin,
        kind: "school", status: "planned", dueDate: data.dueDate,
        assignmentId: created.id, workRole: "study", approvedCosts: [] }]);
    return created.id;
  });
  return NextResponse.json({ ok: true, id: assignmentId });
}
