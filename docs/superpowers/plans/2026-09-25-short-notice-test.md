# Short-Notice Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted Short-notice test schoolwork type that can be planned from one available day with any whole-minute duration, without the normal Test type's two-day refresher rule.

**Architecture:** Store the new type as `short_test` in the existing assignments table and carry it through the Schoolwork API and UI. At the scheduling-core boundary, map only normal `test` to the special two-day algorithm; map `short_test` to the existing flexible assignment algorithm so all time splitting, current-time awareness, sacrifice proposals, approvals, unscheduled saving, and completion behavior remain unchanged.

**Tech Stack:** Next.js, React, TypeScript, Zod, Drizzle ORM, Vitest, Playwright.

---

### Task 1: Lock the scheduling behavior with tests

**Files:**
- Modify: `tests/schoolwork.test.ts`

- [ ] Add a failing test proving a short-notice test due tomorrow accepts one selected day and preserves an exact one-minute total.
- [ ] Add a failing test proving a multi-day short-notice test splits the entered total rather than repeating it on each day.
- [ ] Run `npx vitest run tests/schoolwork.test.ts` and verify the new assertions fail before implementation.

### Task 2: Add the domain type without changing normal tests

**Files:**
- Modify: `src/core/schoolwork.ts`
- Modify: `tests/schoolwork.test.ts`

- [ ] Extend `SchoolworkRequest.kind` with `short-test`.
- [ ] Keep the two-day/refresher branch exclusive to `test`; let `short-test` use the flexible allocation path.
- [ ] Run `npx vitest run tests/schoolwork.test.ts` and verify both the new tests and existing normal-test tests pass.

### Task 3: Carry the persisted type through the API

**Files:**
- Modify: `src/app/api/schoolwork/route.ts`
- Modify: `src/app/api/capture/route.ts`
- Modify: `src/db/schema.ts`

- [ ] Accept persisted kind `short_test` with whole-minute estimates from 1 through 600.
- [ ] Map `short_test` to core kind `short-test`; keep only persisted `test` mapped to core `test`.
- [ ] Preserve `short_test` on assignment insertion and returned assignment data.
- [ ] Update the schema comment documenting allowed assignment kinds; no migration is needed because the column is text.

### Task 4: Expose the option in both schoolwork entry surfaces

**Files:**
- Modify: `src/components/SchoolworkPlanner.tsx`
- Modify: `src/components/CaptureForm.tsx`
- Modify: `src/data/schoolwork-preview.ts`

- [ ] Add a `Short-notice test` choice with an editable whole-minute default.
- [ ] Do not show the normal-test two-day/refresher notice or lock the day-before choice for `short_test`.
- [ ] Recommend available days using flexible allocation, including today when the due date is tomorrow.
- [ ] Make the preview demonstrate a short-notice test due tomorrow so the UI and one-day plan can be visually checked.

### Task 5: Verify behavior and visuals

**Files:**
- Test: `tests/schoolwork.test.ts`
- Visual output: `artifacts/visual/short-notice-test-phone.png`
- Visual output: `artifacts/visual/short-notice-test-desktop.png`

- [ ] Run `npm run check` and require all tests and type checks to pass.
- [ ] Run `npm run build` and require a successful production build.
- [ ] Capture phone and desktop Playwright screenshots of the Due page showing the new type and one-day plan.
- [ ] Show both screenshots to Hashim and wait for explicit visual approval.
- [ ] Do not commit or push until Hashim approves this and the remaining fixes.

## Self-review

- The normal `test` two-day/refresher behavior remains covered and unchanged.
- `short_test` is distinct in storage but intentionally reuses flexible assignment placement.
- Any whole integer minute is supported; totals are allocated once across selected days.
- Existing urgency, sacrifice, sleep, approval, unscheduled-save, graphing, and completion rules remain on the same code paths.
