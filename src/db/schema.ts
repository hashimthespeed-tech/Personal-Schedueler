/**
 * Shared state — the single source of truth every agent reads and writes.
 *
 * This is what makes a hub beat four separate chatbots: the Coach can see
 * sleep and bodyweight before it adds training load, and the scheduler can
 * see every domain's demands at once.
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

/**
 * The integration contract. Every specialist writes this shape; only the
 * scheduler turns one into a block.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    domain: text("domain").notNull(),
    title: text("title").notNull(),
    notes: text("notes"),
    durationMin: integer("duration_min").notNull(),
    minChunkMin: integer("min_chunk_min"),
    deadline: date("deadline"),
    earliestTime: integer("earliest_time"),
    latestTime: integer("latest_time"),
    energy: text("energy").notNull().default("med"),
    priority: integer("priority").notNull().default(3),
    dayPart: text("day_part"),
    recurrence: text("recurrence").notNull().default("once"),
    /** at most one of these per day; set by the emitting agent */
    oncePerDay: boolean("once_per_day").notNull().default(false),
    spacingGroupHint: text("spacing_group_hint"),
    /** ordered detail, shown only when the block is expanded */
    steps: jsonb("steps").$type<string[]>(),
    goalId: integer("goal_id"),
    spacingHours: integer("spacing_hours"),
    spacingGroup: text("spacing_group"),
    allowedWeekdays: jsonb("allowed_weekdays").$type<number[]>(),
    movementTags: jsonb("movement_tags").$type<string[]>(),
    sourceAgent: text("source_agent").notNull(),
    /**
     * A stable slug the emitting agent chooses, unique within that agent.
     *
     * Without it, asking the coach to plan the week twice produced "Lift A —
     * squat / bench / row" and "Lift A - full body" side by side: the prompt
     * said not to duplicate, the model saw the pool, and it duplicated anyway
     * under a different name. Instructions cannot enforce identity; a key can.
     */
    taskKey: text("task_key"),
    /** links a task back to what produced it, e.g. an assignment */
    sourceRef: text("source_ref"),
    status: text("status").notNull().default("open"), // open | done | dropped
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("tasks_status_idx").on(t.status, t.deadline),
    uniqueIndex("tasks_agent_key_idx").on(t.sourceAgent, t.taskKey),
  ],
);

/** Scheduler output. Nothing else writes here. */
export const blocks = pgTable(
  "blocks",
  {
    id: serial("id").primaryKey(),
    taskId: text("task_id").notNull(),
    title: text("title").notNull(),
    domain: text("domain").notNull(),
    onDate: date("on_date").notNull(),
    startMin: integer("start_min").notNull(),
    endMin: integer("end_min").notNull(),
    sourceAgent: text("source_agent").notNull(),
    chunkIndex: integer("chunk_index"),
    chunkCount: integer("chunk_count"),
    notes: text("notes"),
    steps: jsonb("steps").$type<string[]>(),
    goalId: integer("goal_id"),
    /** set from the nightly check-in */
    completed: boolean("completed"),
    planVersion: integer("plan_version").notNull().default(1),
  },
  (t) => [index("blocks_date_idx").on(t.onDate, t.startMin)],
);

/** What the solver could not fit, and why. Surfaced directly in the UI. */
export const unplaced = pgTable("unplaced", {
  id: serial("id").primaryKey(),
  taskId: text("task_id").notNull(),
  title: text("title").notNull(),
  domain: text("domain").notNull(),
  reason: text("reason").notNull(),
  detail: text("detail").notNull(),
  planVersion: integer("plan_version").notNull().default(1),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * What actually happened, and when.
 *
 * Separate from `blocks.completed` because blocks are replaced wholesale on
 * every replan — the plan is a projection, this is the record. Everything the
 * stats page reports is derived from here.
 */
export const completions = pgTable(
  "completions",
  {
    id: serial("id").primaryKey(),
    blockId: integer("block_id"),
    taskId: text("task_id"),
    title: text("title").notNull(),
    domain: text("domain").notNull(),
    goalId: integer("goal_id"),
    onDate: date("on_date").notNull(),
    /** where it was scheduled, so lateness can be measured */
    plannedStartMin: integer("planned_start_min"),
    plannedEndMin: integer("planned_end_min"),
    /** when it was actually marked done */
    completedAt: timestamp("completed_at").notNull().defaultNow(),
    /** minutes credited, normally the block length */
    minutes: integer("minutes").notNull().default(0),
    /** true when marked as skipped rather than done */
    skipped: boolean("skipped").notNull().default(false),
  },
  (t) => [index("completions_date_idx").on(t.onDate, t.domain)],
);

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

export const metrics = pgTable(
  "metrics",
  {
    id: serial("id").primaryKey(),
    onDate: date("on_date").notNull(),
    kind: text("kind").notNull(), // bodyweight | calories | protein | quran-pages | ...
    value: real("value").notNull(),
    unit: text("unit"),
  },
  (t) => [index("metrics_kind_idx").on(t.kind, t.onDate)],
);

/** Every set of every session. The plan's "if you aren't tracking, you're just exercising." */
export const liftLog = pgTable(
  "lift_log",
  {
    id: serial("id").primaryKey(),
    onDate: date("on_date").notNull(),
    session: text("session").notNull(), // push | legs | pull | posterior-shoulders
    exerciseName: text("exercise_name").notNull(),
    setIndex: integer("set_index").notNull(),
    reps: integer("reps").notNull(),
    weight: real("weight"),
  },
  (t) => [index("lift_log_ex_idx").on(t.exerciseName, t.onDate)],
);

/**
 * A gem: one specialised assistant with its own memory and its own chats.
 *
 * The four specialists were too coarse. "Tutor" holding one conversation
 * across five AP courses means every question arrives with four subjects of
 * irrelevant history attached, and none of it accumulates into knowing how he
 * does calculus specifically. A gem per subject fixes both.
 *
 * Each gem still stands on a base specialist for its character and its tools;
 * `instructions` narrows it and `memory` is what it has learned to keep.
 */
export const gems = pgTable("gems", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  blurb: text("blurb"),
  /** grouping in the sidebar */
  category: text("category").notNull(),
  domain: text("domain").notNull(),
  /** which specialist supplies the base prompt and tools */
  agent: text("agent").notNull(),
  /** set when this gem is one specific class */
  courseCode: text("course_code"),
  /** appended to the base prompt */
  instructions: text("instructions"),
  /**
   * What this gem should carry between conversations. Written by the gem
   * itself through the remember tool, so a new chat does not start from
   * nothing.
   */
  memory: text("memory"),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const conversations = pgTable(
  "conversations",
  {
    id: serial("id").primaryKey(),
    gemId: integer("gem_id").notNull(),
    title: text("title").notNull().default("New chat"),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [index("conversations_gem_idx").on(t.gemId, t.updatedAt)],
);

export const messages = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    /** what the turn changed, shown under the reply */
    actions: jsonb("actions").$type<string[]>(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
);

/**
 * Something a specialist cannot plan without.
 *
 * The tutor has no assignments and no test dates; the ustadh does not know how
 * much Quran he wants to read. Left alone, each one guesses, and a guessed week
 * is worse than an empty one. So a specialist declares the gap as data, and the
 * planner turns it into a real block on the calendar — a few minutes to go and
 * tell that gem what it needs. The system schedules its own repair.
 */
export const needs = pgTable(
  "needs",
  {
    id: serial("id").primaryKey(),
    agent: text("agent").notNull(),
    /** the gem to go and answer it in, when there is a specific one */
    gemKey: text("gem_key"),
    /** what to ask him, in his words */
    question: text("question").notNull(),
    /** why planning is stuck without it */
    why: text("why").notNull(),
    /** 1 = nothing sensible can be planned until this is answered */
    urgency: integer("urgency").notNull().default(3),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("needs_open_idx").on(t.agent, t.resolvedAt)],
);

/**
 * A week the planner is proposing.
 *
 * Kept separate from `blocks` so a proposal can be looked at before it becomes
 * the schedule. It adopts itself when the week starts: a plan that needs
 * permission to exist is a plan that stops existing the first busy Sunday.
 */
export const planProposals = pgTable("plan_proposals", {
  id: serial("id").primaryKey(),
  weekStart: date("week_start").notNull(),
  /** proposed | approved | superseded | rejected */
  status: text("status").notNull().default("proposed"),
  /** what the planner decided and why, in plain sentences */
  summary: text("summary").notNull(),
  /** per-specialist notes, keyed by agent */
  reports: jsonb("reports").$type<Record<string, string>>(),
  /** what it could not fit, and why */
  notFitting: jsonb("not_fitting").$type<string[]>(),
  planVersion: integer("plan_version"),
  decidedAt: timestamp("decided_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/**
 * A file attached to a message.
 *
 * Its own table rather than a column on `messages` so that rendering a thread
 * does not drag every photograph in it through memory — the list reads name
 * and type only, and the bytes are fetched per file, which the browser then
 * caches.
 */
export const attachments = pgTable(
  "attachments",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id").notNull(),
    name: text("name").notNull(),
    /** image/jpeg | image/png | image/webp | image/gif | application/pdf */
    mediaType: text("media_type").notNull(),
    bytes: integer("bytes").notNull(),
    /** base64, no data: prefix */
    data: text("data").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("attachments_message_idx").on(t.messageId)],
);

/** Superseded by conversations + messages; kept so old captures are not lost. */
export const agentThreads = pgTable("agent_threads", {
  id: serial("id").primaryKey(),
  agent: text("agent").notNull(), // coach | tutor | ustadh | builder
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Stage B's written explanation of what it changed and why. */
export const planReviews = pgTable("plan_reviews", {
  id: serial("id").primaryKey(),
  planVersion: integer("plan_version").notNull(),
  onDate: date("on_date").notNull(),
  summary: text("summary").notNull(),
  changes: jsonb("changes").$type<{ action: string; taskId: string; why: string }[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

/** Single-row settings. */
export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  timezone: text("timezone").notNull(),
  dayStartMin: integer("day_start_min").notNull(),
  fajrInterruptionMin: integer("fajr_interruption_min").notNull(),
  targetSleepMin: integer("target_sleep_min").notNull(),
  startBedtimeMin: integer("start_bedtime_min").notNull(),
  goalBedtimeMin: integer("goal_bedtime_min").notNull(),
  rampMinutesPerWeek: integer("ramp_minutes_per_week").notNull(),
  rampStartDate: date("ramp_start_date").notNull(),
  maxUtilization: real("max_utilization").notNull().default(0.7),
  wrestlingPhase: text("wrestling_phase").notNull().default("preseason"),
  restrictions: jsonb("restrictions").$type<string[]>(),
  heightIn: real("height_in"),
  bodyweightGoalLb: real("bodyweight_goal_lb"),
  calorieTarget: integer("calorie_target"),
  proteinTargetG: integer("protein_target_g"),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
