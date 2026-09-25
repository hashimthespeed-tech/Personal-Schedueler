# Recurring Commitments Implementation Plan

> **Execution:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show checkable recurring prayers, wrestling, and workouts in Today while using the same source to protect their time from task placement.

**Architecture:** Add a pure recurring-commitments module that produces visible occurrences and hidden/visible planner blocks for a date. The task API merges routine-log completion into those occurrences, while Today merges them with saved tasks without storing duplicate daily task rows.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle/Postgres, Luxon, Zod, Vitest, Playwright

---

### Task 1: Define recurring commitments once

**Files:**
- Create: `src/core/recurring-commitments.ts`
- Create: `tests/recurring-commitments.test.ts`

- [ ] **Step 1: Write failing recurrence tests**

Test Monday, Wednesday, Tuesday, Friday, weekend, and school-closure dates. Assert Fajr 365–377, Maghrib/Isha 1140–1152, weekday Dhuhr/Asr after the correct buffer, Tuesday/Thursday wrestling, workouts only Monday/Friday/Saturday/Sunday, and unique stable slot keys.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run tests/recurring-commitments.test.ts`

Expected: failure because the module does not exist.

- [ ] **Step 3: Implement the pure occurrence source**

Create typed `RecurringCommitment` and `RecurringKind` values and a `recurringCommitmentsFor(date)` function. Reuse `fixedCommitmentsFor`, `homeTimeFor`, `PRACTICE_DAYS`, `TERM_S1`, and the existing prayer calculation for non-school Dhuhr/Asr.

- [ ] **Step 4: Run the focused test**

Run: `npx vitest run tests/recurring-commitments.test.ts`

Expected: all recurrence tests pass.

### Task 2: Make the planner frame match the visible schedule

**Files:**
- Modify: `src/core/adaptive.ts`
- Modify: `src/core/day-frame.ts`
- Modify: `tests/day-frame.test.ts`
- Modify: `tests/task-plan.test.ts`

- [ ] **Step 1: Add failing frame and placement tests**

Assert open morning time before 7:40 AM, hidden preparation from 7:40 AM, exact prayer protection, 30/45-minute arrival buffers, wrestling/workout blocks, no Wednesday workout, the 9:00 PM normal cutoff, next-day school-only emergency access, wind-down/sleep costs, and the 10:45 PM hard end.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `npx vitest run tests/day-frame.test.ts tests/task-plan.test.ts`

Expected: failures under the previous frame and bedtime-only cutoff.

- [ ] **Step 3: Extend `DayTemplate` with explicit cutoffs**

Add `workCutoff` and `emergencyEnd`. Keep `bedtime` at 10:00 PM and wake/nextWake at 6:00 AM. Update adaptive placement to use `workCutoff` normally and `emergencyEnd` only for next-day schoolwork while retaining the seven-hour sleep floor.

- [ ] **Step 4: Build frame blocks from the shared recurrence source**

Map prayer and wrestling occurrences to fixed/protected blocks, workout to the existing flexible routine-cost policy, and add hidden preparation, arrival, and 9:00–10:00 wind-down blocks. Do not add visible transition entries.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run tests/recurring-commitments.test.ts tests/day-frame.test.ts tests/task-plan.test.ts tests/adaptive.test.ts tests/schoolwork.test.ts tests/schoolwork-tradeoffs.test.ts`

Expected: all focused scheduler tests pass.

### Task 3: Return and persist recurring completion

**Files:**
- Modify: `src/app/api/tasks/route.ts`
- Create: `src/core/today-timeline.ts`
- Create: `tests/today-timeline.test.ts`

- [ ] **Step 1: Add failing timeline and validation tests**

Assert saved and recurring items merge chronologically with stable prefixed IDs, recurring completion maps from `routine_log`, and invalid date/slot combinations are rejected by the pure recurring lookup.

- [ ] **Step 2: Implement timeline helpers**

Create a pure merge helper that leaves overdue/moved saved tasks in their existing trays and merges only timed active tasks with recurring occurrences.

- [ ] **Step 3: Extend the task API**

Load same-date routine rows with saved tasks. Return recurring items with `planned` or `done` state. Add `mark-recurring` with `{ onDate, slotKey, status }`, validate the slot against `recurringCommitmentsFor(onDate)`, upsert `done`, and delete the row when toggled back to `planned`.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `npx vitest run tests/today-timeline.test.ts tests/recurring-commitments.test.ts && npm run typecheck`

Expected: tests and typecheck pass.

### Task 4: Merge recurring cards into Today

**Files:**
- Modify: `src/components/AdaptiveDayView.tsx`
- Modify: `src/components/adaptive-day-view.css`
- Modify: `src/data/tasks-preview.ts`

- [ ] **Step 1: Extend the Today payload and preview**

Add recurring items to `DayPayload` and to the deterministic preview fixture. Use the pure timeline helper for chronological rendering.

- [ ] **Step 2: Reuse the task card and checkbox interaction**

Render recurring cards with their title, time, and duration. Call `mark-recurring`; update local state on success; omit Move for recurring items. Remove the old “prayer + shower protected” banner because prayer is now a visible card and the buffer stays hidden.

- [ ] **Step 3: Preserve existing task behavior**

Keep saved-task marking, moving, adding, overdue trays, counts, modal, navigation, and styles. Add only a small recurring-kind label if it remains visually consistent.

- [ ] **Step 4: Run full automated verification**

Run: `npm run check && npm run build`

Expected: typecheck, all tests, and the production build pass.

### Task 5: Visual approval and release preparation

**Files:**
- No source changes expected after approval

- [ ] **Step 1: Start the isolated preview**

Run: `npm run dev -- --port 8767`

- [ ] **Step 2: Capture Today at phone and desktop sizes**

Run Playwright screenshots at 390×844 and 1280×900 using the development preview. Capture enough of the timeline to show prayers, wrestling or workout, saved tasks, and the fixed bottom navigation.

- [ ] **Step 3: Show screenshots to Hashim**

Wait for explicit approval. Do not commit, merge, push, or deploy UI files before approval.

- [ ] **Step 4: Complete the approved branch**

After approval, commit the source/tests/docs, fast-forward merge into `claude/peaceful-dirac-wrmq5e`, rerun `npm run check` and `npm run build`, push to GitHub, wait for Vercel Ready, and verify the production login route.

### Task 6: Reclaim future time after early completion

**Files:**
- Create: `src/core/rebalance.ts`
- Create: `tests/rebalance.test.ts`
- Modify: `src/db/schema.ts`
- Modify: `src/lib/schema-guard.ts`
- Modify: `src/app/api/tasks/route.ts`
- Modify: `src/app/api/schoolwork/route.ts`
- Modify: `src/core/task-plan.ts`
- Modify: `src/core/week.ts`
- Modify: `src/components/WeekPlanner.tsx`

- [ ] Record the actual completion date so a task finished before its scheduled date remains history without occupying the future timeline.
- [ ] Reclaim the completed task's former interval automatically for planned sessions that carry approved sacrifice costs.
- [ ] Restore sacrifice in this order: sleep, before-sleep time, routine/workout time, then friend time.
- [ ] Split a sacrificed session when only part fits, preserving its exact total assignment minutes and reducing its cost by the moved amount.
- [ ] Leave the opened interval blank when no planned task is sacrificing time.
- [ ] Exclude completed tasks from future collision calculations while retaining them in completion history.
- [ ] Verify early-completion and undo behavior, then capture Week screenshots before any commit.
