import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "@/db/index";
import { assignments, routineLog, scheduledTasks } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { today } from "@/core/clock";
import { LA_MESA } from "@/core/prayer";
import { buildDayFrame } from "@/core/day-frame";
import { previewTask, previewTaskEdit, type ExistingTask, type QuickAddRequest, type TaskOption } from "@/core/task-plan";
import { recurringCommitmentFor } from "@/core/recurring-commitments";
import { recurringItemsForToday } from "@/core/today-timeline";
import { rebalanceFreedSlot } from "@/core/rebalance";

export const dynamic = "force-dynamic";

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const choiceFields = {
  date: iso,
  title: z.string().trim().min(1).max(120),
  durationMin: z.number().int().min(5).max(480),
  kind: z.enum(["school", "personal"]),
  mode: z.enum(["auto", "fixed", "past"]),
  at: z.number().int().min(0).max(1439).optional(),
  dueDate: iso.optional(),
};
const body = z.union([
  z.object({ action: z.literal("preview"), ...choiceFields }),
  z.object({ action: z.literal("approve"), ...choiceFields, chosen: z.unknown() }),
  z.object({ action: z.literal("mark"), id: z.number().int().positive(), status: z.enum(["done", "planned"]) }),
  z.object({ action: z.literal("mark-recurring"), onDate: iso, slotKey: z.string().min(1).max(60),
    status: z.enum(["done", "planned"]) }),
  z.object({ action: z.literal("preview-move"), id: z.number().int().positive(), toDate: iso,
    mode: z.enum(["auto", "fixed", "past"]), at: z.number().int().min(0).max(1439).optional() }),
  z.object({ action: z.literal("approve-move"), id: z.number().int().positive(), toDate: iso,
    mode: z.enum(["auto", "fixed", "past"]), at: z.number().int().min(0).max(1439).optional(), chosen: z.unknown() }),
  z.object({ action: z.literal("preview-edit"), id: z.number().int().positive(), toDate: iso,
    durationMin: z.number().int().min(5).max(480), mode: z.enum(["auto", "fixed"]),
    at: z.number().int().min(0).max(1439).optional() }),
  z.object({ action: z.literal("approve-edit"), id: z.number().int().positive(), toDate: iso,
    durationMin: z.number().int().min(5).max(480), mode: z.enum(["auto", "fixed"]),
    at: z.number().int().min(0).max(1439).optional(), chosen: z.unknown() }),
]);

function validDate(value: string) {
  const parsed = DateTime.fromISO(value);
  return parsed.isValid && parsed.toISODate() === value;
}

function currentMinute() {
  const now = DateTime.now().setZone(LA_MESA.timezone);
  return now.hour * 60 + now.minute;
}

function error(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

type TaskRow = typeof scheduledTasks.$inferSelect;

function asExisting(rows: TaskRow[]): ExistingTask[] {
  return rows.map((row) => ({ id: String(row.id), title: row.title, start: row.startMin,
    end: row.startMin === null ? null : row.startMin + row.durationMin,
    status: row.status as ExistingTask["status"] }));
}

async function optionsFor(date: string, request: QuickAddRequest) {
  const rows = await db.select().from(scheduledTasks).where(eq(scheduledTasks.onDate, date));
  const frame = buildDayFrame(date, { sleepMode: "current" });
  const notBefore = date === today() ? Math.max(frame.wake, currentMinute()) : frame.wake;
  return previewTask(frame, request, asExisting(rows), notBefore);
}

async function editOptionsFor(source: TaskRow, date: string, request: QuickAddRequest) {
  const rows = await db.select().from(scheduledTasks).where(eq(scheduledTasks.onDate, date));
  const frame = buildDayFrame(date, { sleepMode: "current" });
  const notBefore = date === today() ? Math.max(frame.wake, currentMinute()) : frame.wake;
  return date === source.onDate ? previewTaskEdit(frame, request, asExisting(rows), String(source.id), notBefore) :
    previewTask(frame, request, asExisting(rows), notBefore);
}

function chosenOption(options: TaskOption[], chosen: unknown): TaskOption | undefined {
  return options.find((option) => JSON.stringify(option) === JSON.stringify(chosen));
}

function validatePlacement(date: string, mode: QuickAddRequest["mode"], dueDate?: string) {
  if (!validDate(date)) return "Choose a valid date.";
  if (mode === "past" && date > today()) return "An overdue task must be for today or an earlier day.";
  if (mode !== "past" && date < today()) return "For something that already passed, choose Add as overdue.";
  if (dueDate && (!validDate(dueDate) || date >= dueDate)) return "Schoolwork must be scheduled before it is due.";
  return null;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return error("Sign in first.", 401);
  const date = new URL(request.url).searchParams.get("date") ?? today();
  if (!validDate(date)) return error("Choose a valid date.");
  const [tasks, marks] = await Promise.all([
    db.select().from(scheduledTasks).where(eq(scheduledTasks.onDate, date)),
    db.select({ slotKey: routineLog.slotKey, status: routineLog.status })
      .from(routineLog).where(eq(routineLog.onDate, date)),
  ]);
  return NextResponse.json({ ok: true, date, frame: buildDayFrame(date, { sleepMode: "current" }), tasks,
    recurring: recurringItemsForToday(date, marks) });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return error("Sign in first.", 401);
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid task.");
  const data = parsed.data;

  if (data.action === "mark-recurring") {
    if (!validDate(data.onDate) || !recurringCommitmentFor(data.onDate, data.slotKey)) {
      return error("That recurring item does not exist on this date.");
    }
    if (data.status === "planned") {
      await db.delete(routineLog).where(and(eq(routineLog.onDate, data.onDate), eq(routineLog.slotKey, data.slotKey)));
    } else {
      await db.insert(routineLog).values({ onDate: data.onDate, slotKey: data.slotKey, status: "done" })
        .onConflictDoUpdate({ target: [routineLog.onDate, routineLog.slotKey], set: { status: "done" } });
    }
    return NextResponse.json({ ok: true, status: data.status });
  }

  if (data.action === "mark") {
    const [source] = await db.select().from(scheduledTasks).where(eq(scheduledTasks.id, data.id)).limit(1);
    const expectedStatus = data.status === "done" ? "planned" : "done";
    if (!source || source.status !== expectedStatus) {
      return error("Task changed or was not found. Refresh and try again.", 409);
    }
    const completedToday = today();
    const completedEarly = data.status === "done" && source.onDate > completedToday && source.startMin !== null;
    const undoingEarly = data.status === "planned" && !!source.completedOn && source.completedOn < source.onDate;
    const result = await db.transaction(async (tx) => {
      const sameDay = (completedEarly || undoingEarly) ?
        await tx.select().from(scheduledTasks).where(eq(scheduledTasks.onDate, source.onDate)) : [];
      const oldStart = source.startMin;
      const oldEnd = oldStart === null ? null : oldStart + source.durationMin;
      const collision = undoingEarly && oldStart !== null && oldEnd !== null && sameDay.some((task) =>
        task.id !== source.id && task.status === "planned" && task.startMin !== null &&
        Math.max(oldStart, task.startMin) < Math.min(oldEnd, task.startMin + task.durationMin));
      const [updated] = await tx.update(scheduledTasks).set({
        status: data.status,
        completedOn: data.status === "done" ? completedToday : null,
        ...(collision ? { startMin: null, approvedCosts: [] } : {}),
      }).where(and(eq(scheduledTasks.id, data.id), eq(scheduledTasks.status, expectedStatus)))
        .returning({ id: scheduledTasks.id, assignmentId: scheduledTasks.assignmentId });
      if (!updated) return null;

      let rebalanced = 0;
      if (completedEarly) {
        const plan = rebalanceFreedSlot(source, sameDay);
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
        rebalanced = plan.updates.length + plan.splits.length;
      }
      return { ...updated, rebalanced, needsTime: collision };
    });
    if (!result) return error("Task changed or was not found. Refresh and try again.", 409);
    if (result.assignmentId !== null) {
      const sessions = await db.select({ status: scheduledTasks.status }).from(scheduledTasks)
        .where(eq(scheduledTasks.assignmentId, result.assignmentId));
      const active = sessions.filter((item) => item.status !== "moved" && item.status !== "cancelled");
      await db.update(assignments).set({ status: active.length > 0 && active.every((item) => item.status === "done") ? "done" : "open" })
        .where(eq(assignments.id, result.assignmentId));
    }
    return NextResponse.json({ ok: true, rebalanced: result.rebalanced, needsTime: result.needsTime });
  }

  if (data.action === "preview-edit" || data.action === "approve-edit") {
    const [source] = await db.select().from(scheduledTasks).where(eq(scheduledTasks.id, data.id)).limit(1);
    if (!source || source.status !== "planned") return error("Only unfinished tasks can be edited.", 409);
    if (source.workRole === "refresher" && data.toDate !== source.onDate) {
      return error("The test refresher must stay on the day before the test.");
    }
    if (source.workRole === "study" && source.dueDate && source.assignmentId) {
      const [parent] = await db.select({ kind: assignments.kind }).from(assignments).where(eq(assignments.id, source.assignmentId)).limit(1);
      if (parent?.kind === "test" && DateTime.fromISO(source.dueDate).minus({ days: 1 }).toISODate() === data.toDate) {
        return error("Test study time must be earlier than the refresher day.");
      }
    }
    const placementError = validatePlacement(data.toDate, data.mode, source.dueDate ?? undefined);
    if (placementError) return error(placementError);
    const request: QuickAddRequest = { title: source.title, durationMin: data.durationMin,
      kind: source.kind as QuickAddRequest["kind"], mode: data.mode,
      ...(data.at === undefined ? {} : { at: data.at }),
      urgentDueTomorrow: !!source.dueDate && DateTime.fromISO(source.dueDate).minus({ days: 1 }).toISODate() === data.toDate };
    const options = await editOptionsFor(source, data.toDate, request);
    if (data.action === "preview-edit") return NextResponse.json({ ok: true, options });
    const chosen = chosenOption(options, data.chosen);
    if (!chosen) return error("The available times changed. Please review the options again.", 409);

    if (data.toDate === source.onDate) {
      const [updated] = await db.update(scheduledTasks).set({ durationMin: data.durationMin,
        startMin: chosen.start, approvedCosts: chosen.costs })
        .where(and(eq(scheduledTasks.id, source.id), eq(scheduledTasks.status, "planned")))
        .returning({ id: scheduledTasks.id });
      if (!updated) return error("Task changed while editing. Refresh and try again.", 409);
      return NextResponse.json({ ok: true, id: updated.id });
    }

    const result = await db.transaction(async (tx) => {
      const [moved] = await tx.update(scheduledTasks).set({ status: "moved", movedToDate: data.toDate })
        .where(and(eq(scheduledTasks.id, source.id), eq(scheduledTasks.status, "planned")))
        .returning({ id: scheduledTasks.id });
      if (!moved) return null;
      const [newTask] = await tx.insert(scheduledTasks).values({ title: source.title, onDate: data.toDate,
        durationMin: data.durationMin, startMin: chosen.start, dueDate: source.dueDate,
        kind: source.kind, status: "planned", approvedCosts: chosen.costs,
        assignmentId: source.assignmentId, workRole: source.workRole }).returning({ id: scheduledTasks.id });
      return newTask;
    });
    if (!result) return error("Task changed while editing. Refresh and try again.", 409);
    return NextResponse.json({ ok: true, id: result.id });
  }

  if (data.action === "preview-move" || data.action === "approve-move") {
    const [source] = await db.select().from(scheduledTasks).where(eq(scheduledTasks.id, data.id)).limit(1);
    if (!source || source.status !== "planned") return error("Only unfinished tasks can be moved.", 409);
    if (data.toDate === source.onDate) return error("Choose a different day.");
    if (source.workRole === "refresher") return error("The test refresher must stay on the day before the test.");
    if (source.workRole === "study" && source.dueDate && source.assignmentId) {
      const [parent] = await db.select({ kind: assignments.kind }).from(assignments).where(eq(assignments.id, source.assignmentId)).limit(1);
      if (parent?.kind === "test" && DateTime.fromISO(source.dueDate).minus({ days: 1 }).toISODate() === data.toDate) {
        return error("Test study time must be earlier than the refresher day.");
      }
    }
    const placementError = validatePlacement(data.toDate, data.mode, source.dueDate ?? undefined);
    if (placementError) return error(placementError);
    const request: QuickAddRequest = { title: source.title, durationMin: source.durationMin,
      kind: source.kind as QuickAddRequest["kind"], mode: data.mode,
      ...(data.at === undefined ? {} : { at: data.at }),
      urgentDueTomorrow: !!source.dueDate && DateTime.fromISO(source.dueDate).minus({ days: 1 }).toISODate() === data.toDate };
    const options = await optionsFor(data.toDate, request);
    if (data.action === "preview-move") return NextResponse.json({ ok: true, options });
    const chosen = chosenOption(options, data.chosen);
    if (!chosen) return error("The available times changed. Please review the options again.", 409);
    const result = await db.transaction(async (tx) => {
      const [moved] = await tx.update(scheduledTasks).set({ status: "moved", movedToDate: data.toDate })
        .where(and(eq(scheduledTasks.id, source.id), eq(scheduledTasks.status, "planned")))
        .returning({ id: scheduledTasks.id });
      if (!moved) return null;
      const [newTask] = await tx.insert(scheduledTasks).values({ title: source.title, onDate: data.toDate,
        durationMin: source.durationMin, startMin: chosen.start, dueDate: source.dueDate,
        kind: source.kind, status: "planned", approvedCosts: chosen.costs,
        assignmentId: source.assignmentId, workRole: source.workRole }).returning({ id: scheduledTasks.id });
      return newTask;
    });
    if (!result) return error("Task changed while moving. Refresh and try again.", 409);
    return NextResponse.json({ ok: true, id: result.id });
  }

  const placementError = validatePlacement(data.date, data.mode, data.dueDate);
  if (placementError) return error(placementError);
  const planRequest: QuickAddRequest = { title: data.title, durationMin: data.durationMin,
    kind: data.kind, mode: data.mode, ...(data.at === undefined ? {} : { at: data.at }),
    urgentDueTomorrow: !!data.dueDate && DateTime.fromISO(data.dueDate).minus({ days: 1 }).toISODate() === data.date };
  const options = await optionsFor(data.date, planRequest);
  if (data.action === "preview") return NextResponse.json({ ok: true, options });
  const chosen = chosenOption(options, data.chosen);
  if (!chosen) return error("The available times changed. Please review the options again.", 409);
  const [created] = await db.insert(scheduledTasks).values({ title: data.title, onDate: data.date,
    durationMin: data.durationMin, startMin: chosen.start, dueDate: data.dueDate ?? null,
    kind: data.kind, status: "planned", approvedCosts: chosen.costs }).returning({ id: scheduledTasks.id });
  return NextResponse.json({ ok: true, id: created?.id });
}
