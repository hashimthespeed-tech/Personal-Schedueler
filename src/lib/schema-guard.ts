/**
 * Detecting a database that is behind the code.
 *
 * Deploying a schema change without running db:push makes every query
 * touching that table fail, and Next.js strips the message in production —
 * so the whole app becomes a blank "server error" with no clue that a
 * one-line command fixes it. This turns that into an answer.
 */

import { sql } from "drizzle-orm";
import { db } from "@/db/index";

export interface SchemaStatus {
  ok: boolean;
  /** tables that do not exist at all */
  missingTables: string[];
  /** "table.column" for columns the code expects and the database lacks */
  missingColumns: string[];
}

/** Columns added after the first deploy, which are the ones likely to be missing. */
const EXPECTED: Record<string, string[]> = {
  tasks: ["task_key","day_part", "recurrence", "once_per_day", "steps", "goal_id", "spacing_group_hint"],
  blocks: ["notes", "steps", "goal_id"],
  goals: ["weekly_target"],
  check_ins: ["wake_min", "bedtime_min"],
  completions: ["block_id", "skipped", "minutes"],
  gems: ["key", "label", "category", "agent", "memory"],
  conversations: ["gem_id", "title"],
  messages: ["conversation_id", "role", "content"],
  attachments: ["message_id", "media_type", "data"],
  needs: ["agent", "question", "why", "resolved_at"],
  plan_proposals: ["week_start", "status", "summary"],
};

export async function checkSchema(): Promise<SchemaStatus> {
  const missingTables: string[] = [];
  const missingColumns: string[] = [];

  try {
    const rows = await db.execute<{ table_name: string; column_name: string }>(
      sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`,
    );

    const present = new Map<string, Set<string>>();
    for (const row of rows as unknown as { table_name: string; column_name: string }[]) {
      const set = present.get(row.table_name) ?? new Set<string>();
      set.add(row.column_name);
      present.set(row.table_name, set);
    }

    for (const [table, columns] of Object.entries(EXPECTED)) {
      const found = present.get(table);
      if (!found) {
        missingTables.push(table);
        continue;
      }
      for (const column of columns) {
        if (!found.has(column)) missingColumns.push(`${table}.${column}`);
      }
    }
  } catch {
    // cannot even read the catalogue — the connection itself is the problem,
    // and db:check is the tool for that
    return { ok: false, missingTables: ["(could not reach the database)"], missingColumns: [] };
  }

  return {
    ok: missingTables.length === 0 && missingColumns.length === 0,
    missingTables,
    missingColumns,
  };
}
