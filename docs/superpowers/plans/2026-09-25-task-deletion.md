# Permanent Task Deletion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add permanent deletion for individual saved tasks and whole school assignments, with exact scope, confirmation, schedule rebalancing, and immediate removal from every view and completion total.

**Architecture:** Extend the existing task and schoolwork POST APIs with authenticated delete actions. Reuse the pure freed-slot rebalancer after deleting planned scheduled work; delete assignment sessions and their parent in one transaction. Use one shared confirmation component in Today, Week, and Due so destructive behavior is consistent without making recurring commitments deletable.

**Tech Stack:** Next.js, React, TypeScript, Drizzle ORM, PostgreSQL, Zod, Vitest, Playwright.

---

### Task 1: Lock deletion rebalancing behavior

**Files:**
- Modify: `src/core/rebalance.ts`
- Modify: `tests/rebalance.test.ts`

- [ ] Add failing tests proving planned saved work exposes a freed slot for rebalancing, while completed and unplaced work does not.
- [ ] Run `npx vitest run tests/rebalance.test.ts` and verify the new tests fail.
- [ ] Add a small pure `rebalanceAfterDeletion` wrapper that returns no updates for completed or unplaced sources and otherwise delegates to `rebalanceFreedSlot`.
- [ ] Run the focused tests and verify they pass without changing priority ordering or exact-minute preservation.

### Task 2: Permanently delete one task

**Files:**
- Modify: `src/app/api/tasks/route.ts`

- [ ] Add `{ action: "delete", id }` to request validation.
- [ ] Load the exact row and return 404 when it is missing.
- [ ] In one transaction, delete only that scheduled-task row, query remaining same-day tasks, apply `rebalanceAfterDeletion`, and create any required split rows.
- [ ] Do not update or delete a linked parent assignment.
- [ ] Return the deleted id and rebalanced count.

### Task 3: Permanently delete one assignment

**Files:**
- Modify: `src/app/api/schoolwork/route.ts`

- [ ] Add `{ action: "delete", id }` as a request shape separate from create/preview fields.
- [ ] Load the assignment and return 404 when it is missing.
- [ ] In one transaction, load all linked sessions, delete them, delete the assignment, then rebalance each affected planned occupied slot against the remaining current state.
- [ ] Ensure completed, moved, and unplaced linked rows are removed but do not falsely restore time.
- [ ] Return the deleted assignment id, deleted-session count, and rebalanced count.

### Task 4: Add one shared destructive confirmation

**Files:**
- Create: `src/components/DeleteConfirm.tsx`
- Create: `src/components/delete-confirm.css`

- [ ] Build an accessible modal with the exact selected name, explicit “forever” language, Cancel, and a destructive confirmation button.
- [ ] Disable both actions while the delete request is running and display caller-provided API errors outside the modal.

### Task 5: Add individual deletion to Today and Week

**Files:**
- Modify: `src/components/AdaptiveDayView.tsx`
- Modify: `src/components/adaptive.css`
- Modify: `src/components/WeekPlanner.tsx`
- Modify: `src/components/week-planner.css`

- [ ] Add Delete only to saved task rows; recurring prayer, wrestling, and workout entries receive no Delete action.
- [ ] Today opens the shared confirmation from planned, completed, and unplaced saved rows.
- [ ] Week opens the shared confirmation from the existing editor sheet, including completed-early entries.
- [ ] In preview mode, remove only the selected task locally; live mode calls `/api/tasks`, reloads, and dispatches `scheduler:tasks-changed`.

### Task 6: Add assignment deletion to Due

**Files:**
- Modify: `src/components/SchoolworkPlanner.tsx`
- Modify: `src/components/schoolwork-planner.css`

- [ ] Add Delete assignment to each Coming up card.
- [ ] Open the shared confirmation naming the assignment.
- [ ] In preview mode, remove the assignment locally; live mode calls `/api/schoolwork`, reloads, and dispatches `scheduler:tasks-changed`.

### Task 7: Verify behavior and visuals

**Files:**
- Test: `tests/rebalance.test.ts`
- Visual output: `artifacts/visual/task-delete-*.png`

- [ ] Run `npm run check` and require all tests and type checks to pass.
- [ ] Run `npm run build` and require a successful production build.
- [ ] Use Playwright to capture phone and desktop screenshots of Today, Week, and Due deletion confirmation states.
- [ ] Show all affected pages to Hashim and wait for explicit visual approval.
- [ ] Do not commit implementation, merge, push, alter the database, or deploy until Hashim approves the screenshots.

## Self-review

- Individual deletion and whole-assignment deletion have distinct, explicit scopes.
- Recurring commitments cannot accidentally be deleted.
- Hard deletion removes graph history by removing source records rather than adding a hidden status.
- Rebalancing happens only for planned occupied slots and reuses the already-tested priority rules.
- Missing targets fail safely and transactions prevent partial assignment deletion.
