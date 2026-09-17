/**
 * What the app remembers.
 *
 * The day itself is not in here — it is a pure function in `core/routine.ts`,
 * the same shape every week. These tables hold only the things a function
 * cannot know: what he actually did, when he slept, and what is due.
 */

import {
  pgTable, serial, text, integer, real, boolean, timestamp, date, jsonb, index, unique, uniqueIndex,
} from "drizzle-orm/pg-core";

/** Five life domains. */
export const DOMAINS = ["school", "deen", "ai", "money", "physique"] as const;

export const goals = pgTable("goals", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  northStar: text("north_star").notNull(),
  currentFocus: text("current_focus"),
  /** stated target date, if the user set one */
  targetDate: date("target_date"),
  /**
   * Sessions per week this goal needs to be on track. Progress is measured
   * against it, so a goal with no target is measured on consistency alone —
   * what fraction of what was scheduled actually happened.
   */
  weeklyTarget: integer("weekly_target"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const courses = pgTable("courses", {
  id: serial("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  teacher: text("teacher"),
  room: text("room"),
  period: integer("period").notNull(),
  /** ap | honors | standard | pe | free */
  rigor: text("rigor").notNull(),
  /** which goal domain its homework counts toward */
  domain: text("domain").notNull().default("school"),
  baselineHomeworkMin: integer("baseline_homework_min").notNull().default(30),
  termStart: date("term_start").notNull(),
  termEnd: date("term_end").notNull(),
});

export const assignments = pgTable(
  "assignments",
  {
    id: serial("id").primaryKey(),
    courseId: integer("course_id").references(() => courses.id),
    title: text("title").notNull(),
    kind: text("kind").notNull().default("homework"), // homework | test | project | reading
    dueDate: date("due_date"),
    estimatedMin: integer("estimated_min").notNull().default(45),
    /** how much of the course grade rides on it, 0..1 */
    gradeWeight: real("grade_weight"),
    status: text("status").notNull().default("open"), // open | done | dropped
    notes: text("notes"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("assignments_due_idx").on(t.dueDate, t.status)],
);

export const fixedCommitments = pgTable("fixed_commitments", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  weekday: integer("weekday"), // 1 = Mon .. 7 = Sun; null when one-off
  onDate: date("on_date"),
  startMin: integer("start_min").notNull(),
  endMin: integer("end_min").notNull(),
  kind: text("kind").notNull(), // school | practice | prayer | meal | commute | other
  offSite: boolean("off_site").notNull().default(false),
  workable: boolean("workable").notNull().default(false),
});

export const checkIns = pgTable("check_ins", {
  id: serial("id").primaryKey(),
  /** the day he woke up on — sleep is reported the morning after, not the night of */
  onDate: date("on_date").notNull().unique(),
  /** net minutes slept, computed from bedtime and wake, minus the Fajr wake */
  sleepMin: integer("sleep_min"),
  /** when he went to bed the previous evening */
  bedtimeMin: integer("bedtime_min"),
  /** when he actually got up */
  wakeMin: integer("wake_min"),
  energy: integer("energy"), // 1..5
  /** block ids the user tapped as slipped */
  slippedBlockIds: jsonb("slipped_block_ids").$type<number[]>(),
  note: text("note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const prayerLog = pgTable(
  "prayer_log",
  {
    id: serial("id").primaryKey(),
    onDate: date("on_date").notNull(),
    /** fajr | dhuhr-asr | maghrib-isha */
    block: text("block").notNull(),
    status: text("status").notNull(), // on-time | late | missed
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [unique("prayer_log_day_block").on(t.onDate, t.block)],
);

/**
 * What happened in a fixed slot, on a day.
 *
 * This is the whole scheduler-side data model now. It replaces blocks,
 * unplaced, completions and tasks: with the routine fixed, a day's shape is
 * computed rather than stored, and the only thing worth persisting is whether
 * each slot actually happened.
 *
 * Silence is meaningful and is therefore absent rather than recorded as a
 * miss — a day with no rows is a day he did not answer, which is different
 * from a day he failed.
 */
export const routineLog = pgTable(
  "routine_log",
  {
    id: serial("id").primaryKey(),
    onDate: date("on_date").notNull(),
    /** matches Slot.key in core/routine.ts */
    slotKey: text("slot_key").notNull(),
    /** done | missed */
    status: text("status").notNull(),
    /**
     * How hard he went, 1-10. Optional on purpose.
     *
     * The tick has to stay a single tap or the daily loop stops happening —
     * that was the founding constraint and it is easy to spend. So intensity
     * is a second, skippable tap, and every chart has to survive it being
     * null.
     */
    intensity: integer("intensity"),
    /** optional calories for a meal; blank until he knows the amount */
    calories: integer("calories"),
    /** what he actually did, when it is worth keeping */
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("routine_log_day_slot_idx").on(t.onDate, t.slotKey)],
);

/** Days he asked for a second hour of school work. */
export const dayAdjustments = pgTable(
  "day_adjustments",
  {
    id: serial("id").primaryKey(),
    onDate: date("on_date").notNull().unique(),
    extraSchoolHour: boolean("extra_school_hour").notNull().default(false),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
);

/** Single-row settings. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  timezone: text("timezone").notNull(),
  dayStartMin: integer("day_start_min").notNull(),
  targetSleepMin: integer("target_sleep_min").notNull(),
  heightIn: real("height_in"),
  bodyweightGoalLb: real("bodyweight_goal_lb"),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
