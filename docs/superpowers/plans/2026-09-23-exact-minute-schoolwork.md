# Exact-Minute Schoolwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Accept and schedule every positive whole-minute schoolwork estimate without changing existing planning policies.

**Architecture:** Keep the existing Due-page, API, and planning-core boundaries. Change only duration granularity: validate positive integers at the edge, allocate exact integer minutes in the core, and retain the current ordering, capacity, test-day, tradeoff, and sleep rules.

**Tech Stack:** Next.js, React, TypeScript, Zod, Vitest

---

### Task 1: Prove exact-minute core behavior

**Files:**
- Modify: `tests/schoolwork.test.ts`
- Modify: `tests/custom-tradeoff.test.ts`

- [x] **Step 1: Add failing tests**

Add cases proving a one-minute assignment is valid, a 17-minute assignment splits to exactly 17 minutes, a short test still uses two days with at least one minute on each, and a one-minute custom tradeoff can fill an odd shortfall.

- [x] **Step 2: Run the focused tests and confirm they fail**

Run: `npx vitest run tests/schoolwork.test.ts tests/custom-tradeoff.test.ts`

Expected: failures showing the current 15-minute minimum and five-minute allocation rules.

### Task 2: Convert schoolwork planning to exact minutes

**Files:**
- Modify: `src/core/schoolwork.ts`

- [x] **Step 1: Replace five-minute window and capacity rounding with whole-minute capacity**

Keep all existing window ordering and the 120-minute daily cap, but retain each usable integer minute.

- [x] **Step 2: Allocate and balance one minute at a time**

Preserve the current latest-day and balanced-allocation behavior while allowing remainders from 1 through 4 minutes.

- [x] **Step 3: Preserve the test rule at short durations**

Require two days for tests with a minimum total of two minutes. Allocate an approximately 25% refresher of at least one minute and at most 30 minutes, leaving at least one minute for the earlier study day.

- [x] **Step 4: Allow exact-minute tradeoffs**

Keep the same sacrifice ordering and limits, but permit exact integer-minute cuts and sleep adjustments.

- [x] **Step 5: Run focused tests**

Run: `npx vitest run tests/schoolwork.test.ts tests/custom-tradeoff.test.ts tests/schoolwork-tradeoffs.test.ts`

Expected: all focused tests pass.

### Task 3: Accept exact minutes through the Due page

**Files:**
- Modify: `src/app/api/schoolwork/route.ts`
- Modify: `src/components/SchoolworkPlanner.tsx`

- [x] **Step 1: Change API validation**

Accept integer estimates from 1 through 600 and reject zero, negatives, fractions, and values over 600.

- [x] **Step 2: Change the Due-page input**

Set the numeric input to a minimum and step of one minute. Keep presets, maximum, labels, and workflow unchanged.

- [x] **Step 3: Update test-day fallback availability**

Use the new one-minute threshold without changing the requirement that the day before be selected.

- [x] **Step 4: Run the full project check**

Run: `npm run check`

Expected: typecheck succeeds and every test passes.

### Task 4: Verify the release

**Files:**
- No source changes expected

- [x] **Step 1: Build the production bundle**

Run: `npm run build`

Expected: successful production build.

- [x] **Step 2: Visually verify the Due page**

Open the app at phone and desktop sizes, enter a duration below 15 minutes, and capture both screenshots. Confirm the input, recommendations, preview, exact total, and navigation remain visually correct.

- [x] **Step 3: Obtain visual approval**

Show both screenshots to Hashim and wait for explicit approval before committing or pushing the UI change.

- [ ] **Step 4: Commit and integrate**

After approval, commit the exact-minute change, merge it into `claude/peaceful-dirac-wrmq5e`, rerun `npm run check` and `npm run build`, then push that production branch to GitHub for Vercel deployment.
