# Meal Calorie Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track meals and optional calories, add an honest daily-calorie graph, and divide Stats into default Graphs and Numbers tabs.

**Architecture:** Add nullable `calories` to `routine_log`, expose it through the existing day API, and derive sparse daily totals in `core/consistency.ts`. Reuse the existing SVG chart pattern so incomplete food logs yield gaps.

**Tech Stack:** Next.js 16, React 19, TypeScript, Drizzle/Postgres, Vitest.

---

### Task 1: Persist meal calories

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/app/api/day/route.ts`
- Modify: `src/components/DayView.tsx`

- [ ] Add a nullable integer `calories` column to `routine_log`.
- [ ] Accept only non-negative whole-number calories in the mark request.
- [ ] Return calories with each day mark.
- [ ] Allow only fixed meal keys to save calories; preserve existing intensity behavior for core slots.
- [ ] Render meal done/missed controls and an optional calorie field after a meal is done.
- [ ] Save a later calorie edit to the existing row without changing its status.

### Task 2: Derive sparse calorie totals

**Files:**
- Modify: `src/core/routine.ts`
- Modify: `src/core/consistency.ts`
- Modify: `tests/consistency.test.ts`

- [ ] Add an exported meal-slot predicate to the routine model.
- [ ] Extend `LogRow` with nullable calories and `Consistency` with daily calorie observations.
- [ ] Emit a total only when every scheduled meal is answered and each done meal has calories.
- [ ] Leave incomplete dates null so chart code has an explicit gap.
- [ ] Write tests for complete totals, a missing calorie gap, and an unanswered meal gap.

### Task 3: Show calories and split Stats tabs

**Files:**
- Modify: `src/components/Consistency.tsx`
- Modify: `src/app/stats/page.tsx`

- [ ] Add a sparse SVG `CaloriesChart` following `IntensityChart`’s gap-safe segments.
- [ ] Add URL-backed Graphs and Numbers tabs, defaulting to Graphs.
- [ ] Put the grid, intensity chart, and calorie chart on Graphs.
- [ ] Put summary tiles and the slot table on Numbers.
- [ ] Keep range selection across tabs.

### Task 4: Verify

**Files:**
- Modify: generated migration files if Drizzle produces them.

- [ ] Run the focused consistency tests, the full test suite, typecheck, and production build.
- [ ] Run the app locally and inspect Today and Stats at phone width.
- [ ] Commit the complete feature to `claude/peaceful-dirac-wrmq5e`.
