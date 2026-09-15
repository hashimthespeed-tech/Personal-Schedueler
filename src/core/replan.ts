/**
 * Runs Stage A against whatever is currently in the task pool and persists the
 * result. Called after any specialist changes the pool, and nightly.
 */

import { eq, sql } from "drizzle-orm";
import { db } from "../db/index";
import { blocks, settings, tasks, unplaced } from "../db/schema";
import { solve, DEFAULT_MAX_UTILIZATION } from "./solver";
import { slotsForHorizon } from "./slots";
import { DEFAULT_SLEEP, type SleepModel } from "./sleep";
import { LA_MESA, type PrayerConfig } from "./prayer";
import type { Energy, IsoDate, SolverResult, Task } from "./types";

export const HORIZON_DAYS = 7;

function toSolverTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    domain: row.domain as Task["domain"],
    title: row.title,
    notes: row.notes ?? undefined,
    durationMin: row.durationMin,
    minChunkMin: row.minChunkMin,
    deadline: row.deadline ?? undefined,
    earliestTime: row.earliestTime ?? undefined,
    latestTime: row.latestTime ?? undefined,
    energy: row.energy as Energy,
    priority: Math.min(5, Math.max(1, row.priority)) as Task["priority"],
    allowedWeekdays: row.allowedWeekdays ?? undefined,
    movementTags: row.movementTags ?? undefined,
    dayPart: (row.dayPart as Task["dayPart"]) ?? undefined,
    recurrence: (row.recurrence as Task["recurrence"]) ?? "once",
    oncePerDay: row.oncePerDay,
    spacingGroupHint: row.spacingGroupHint ?? undefined,
    steps: row.steps ?? undefined,
    goalId: row.goalId ?? undefined,
    sourceAgent: row.sourceAgent as Task["sourceAgent"],
    ...(row.spacingGroup && row.spacingHours
      ? { spacing: { minHoursBetween: row.spacingHours, groupKey: row.spacingGroup } }
      : {}),
  };
}

async function loadConfig(): Promise<{
  sleep: SleepModel;
  prayer: PrayerConfig;
  restrictions: string[];
  maxUtilization: number;
}> {
  const row = (await db.select().from(settings).limit(1))[0];
  if (!row) {
    return {
      sleep: DEFAULT_SLEEP,
      prayer: LA_MESA,
      restrictions: [],
      maxUtilization: DEFAULT_MAX_UTILIZATION,
    };
  }
  return {
    sleep: {
      dayStart: row.dayStartMin,
      fajrInterruptionMin: row.fajrInterruptionMin,
      returnToSleep: true,
      targetSleepMin: row.targetSleepMin,
      startBedtime: row.startBedtimeMin,
      goalBedtime: row.goalBedtimeMin,
      rampMinutesPerWeek: row.rampMinutesPerWeek,
      rampStartDate: row.rampStartDate,
    },
    prayer: {
      latitude: row.latitude,
      longitude: row.longitude,
      timezone: row.timezone,
      fajrDurationMin: LA_MESA.fajrDurationMin,
      dhuhrAsrDurationMin: LA_MESA.dhuhrAsrDurationMin,
      maghribIshaDurationMin: LA_MESA.maghribIshaDurationMin,
    },
    restrictions: row.restrictions ?? [],
    maxUtilization: row.maxUtilization,
  };
}

async function nextPlanVersion(): Promise<number> {
  const row = (
    await db.select({ v: sql<number>`coalesce(max(${blocks.planVersion}), 0)::int` }).from(blocks)
  )[0];
  return (row?.v ?? 0) + 1;
}

export interface ReplanResult extends SolverResult {
  planVersion: number;
  startDate: IsoDate;
}

/** Solve the horizon and replace the stored plan with the result. */
export async function replan(startDate: IsoDate): Promise<ReplanResult> {
  const config = await loadConfig();
  const openTasks = await db.select().from(tasks).where(eq(tasks.status, "open"));

  const result = solve({
    startDate,
    horizonDays: HORIZON_DAYS,
    tasks: openTasks.map(toSolverTask),
    slots: slotsForHorizon(startDate, HORIZON_DAYS, { sleep: config.sleep, prayer: config.prayer }),
    restrictions: config.restrictions,
    maxUtilization: config.maxUtilization,
  });

  const planVersion = await nextPlanVersion();

  await db.transaction(async (tx) => {
    // the plan is replaced wholesale; completion is re-derived from check-ins
    await tx.delete(blocks);
    await tx.delete(unplaced);

    if (result.blocks.length > 0) {
      await tx.insert(blocks).values(
        result.blocks.map((b) => ({
          taskId: b.taskId,
          title: b.title,
          domain: b.domain,
          onDate: b.date,
          startMin: b.start,
          endMin: b.end,
          sourceAgent: b.sourceAgent,
          chunkIndex: b.chunkIndex ?? null,
          chunkCount: b.chunkCount ?? null,
          notes: b.notes ?? null,
          steps: b.steps ?? null,
          goalId: b.goalId ?? null,
          planVersion,
        })),
      );
    }

    if (result.unplaced.length > 0) {
      await tx.insert(unplaced).values(
        result.unplaced.map((u) => ({
          taskId: u.taskId,
          title: u.title,
          domain: u.domain,
          reason: u.reason,
          detail: u.detail,
          planVersion,
        })),
      );
    }
  });

  return { ...result, planVersion, startDate };
}
