import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "@/db/index";
import { assignments, scheduledTasks } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { today } from "@/core/clock";
import { LA_MESA } from "@/core/prayer";
import { buildDayFrame } from "@/core/day-frame";
import { previewTask, type ExistingTask, type QuickAddRequest, type TaskOption } from "@/core/task-plan";

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
  z.object({ action: z.literal("preview-move"), id: z.number().int().positive(), toDate: iso,
    mode: z.enum(["auto", "fixed", "past"]), at: z.number().int().min(0).max(1439).optional() }),
  z.object({ action: z.literal("approve-move"), id: z.number().int().positive(), toDate: iso,
    mode: z.enum(["auto", "fixed", "past"]), at: z.number().int().min(0).max(1439).optional(), chosen: z.unknown() }),
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
  const tasks = await db.select().from(scheduledTasks).where(eq(scheduledTasks.onDate, date));
  return NextResponse.json({ ok: true, date, frame: buildDayFrame(date, { sleepMode: "current" }), tasks });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return error("Sign in first.", 401);
  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return error(parsed.error.issues[0]?.message ?? "Invalid task.");
  const data = parsed.data;

  if (data.action === "mark") {
    const [updated] = await db.update(scheduledTasks).set({ status: data.status })
      .where(and(eq(scheduledTasks.id, data.id), eq(scheduledTasks.status, data.status === "done" ? "planned" : "done")))
      .returning({ id: scheduledTasks.id, assignmentId: scheduledTasks.assignmentId });
    if (!updated) return error("Task changed or was not found. Refresh and try again.", 409);
    if (updated.assignmentId !== null) {
      const sessions = await db.select({ status: scheduledTasks.status }).from(scheduledTasks)
        .where(eq(scheduledTasks.assignmentId, updated.assignmentId));
      const active = sessions.filter((item) => item.status !== "moved" && item.status !== "cancelled");
      await db.update(assignments).set({ status: active.length > 0 && active.every((item) => item.status === "done") ? "done" : "open" })
        .where(eq(assignments.id, updated.assignmentId));
    }
    return NextResponse.json({ ok: true });
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
