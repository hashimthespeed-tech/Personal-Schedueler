# Custom Trade-off Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Hashim manually distribute a schoolwork shortage across independently limited tasks without changing the required schoolwork total.

**Architecture:** Add a pure custom-allocation model beside the preset trade-off generator. The API returns server-derived sources and revalidates the submitted allocation. A focused client component renders per-source sliders and sends only source IDs and minute values.

**Tech Stack:** TypeScript, Next.js App Router, React, Drizzle/Postgres, Vitest, CSS.

---

### Task 1: Pure per-source allocation model

**Files:**
- Modify: `src/core/schoolwork.ts`
- Create: `tests/custom-tradeoff.test.ts`

- [ ] **Step 1: Write failing isolation and validation tests**

Create two sources with different durations and the same title. Assert IDs remain distinct, their `maxRemovable` values are computed separately, and invalid totals, duplicate IDs, non-five-minute values, and values above the individual maximum are rejected.

- [ ] **Step 2: Run the focused test and verify failure**

Run `npx vitest run tests/custom-tradeoff.test.ts`. Expected: failure because `customTradeoffDraft` and `buildCustomSchoolworkTradeoff` do not exist.

- [ ] **Step 3: Implement the pure model**

Add these public interfaces and functions:

```ts
interface CustomTradeoffSource {
  id: string;
  date: string;
  blockId?: string;
  title: string;
  type: CostType;
  originalMinutes: number;
  minimumMinutes: number;
  maxRemovable: number;
}

interface CustomTradeoffDraft {
  requiredMinutes: number;
  sources: CustomTradeoffSource[];
}

type CustomAllocation = { sourceId: string; minutes: number }[];

function customTradeoffDraft(request: SchoolworkRequest, days: PlanningDay[]): CustomTradeoffDraft | null;
function buildCustomSchoolworkTradeoff(request: SchoolworkRequest, days: PlanningDay[], allocation: CustomAllocation): SchoolworkTradeoff | null;
```

Use `${date}:${block.id}` for routine sources and `${date}:sleep` for sleep. Reuse the clean base sessions, validate every allocation, require the exact shortage total, and preserve at least 420 minutes of sleep.

- [ ] **Step 4: Run focused and full tests**

Run `npx vitest run tests/custom-tradeoff.test.ts` and `npm run check`. Expected: all tests pass.

### Task 2: Server preview and approval validation

**Files:**
- Modify: `src/app/api/schoolwork/route.ts`

- [ ] **Step 1: Return custom sources during preview**

Include `customDraft` beside `plan` and preset `tradeoffs` whenever the clean plan fails.

- [ ] **Step 2: Accept a custom allocation during approval**

Extend the approve payload with optional `customAllocation`. Rebuild the custom option on the server; use its sessions only when validation succeeds. Never trust client-provided limits, titles, durations, or computed sessions.

- [ ] **Step 3: Verify API typing and regression suite**

Run `npm run check`. Expected: typecheck and all tests pass.

### Task 3: Phone-first custom editor

**Files:**
- Create: `src/components/CustomTradeoffEditor.tsx`
- Create: `src/components/custom-tradeoff-editor.css`
- Modify: `src/components/SchoolworkPlanner.tsx`

- [ ] **Step 1: Render independently keyed sliders**

Use `source.id` as the React key and allocation-map key. Each range input has `min=0`, `max=source.maxRemovable`, and `step=5`. Show original duration, minimum remaining, and selected reduction for that source.

- [ ] **Step 2: Add exact-total behavior**

Compute `remaining = requiredMinutes - selectedTotal`. Disable approval unless `remaining === 0`. Reset the allocation whenever the assignment details or selected days change.

- [ ] **Step 3: Connect approval**

Send `{ action: "approve", ...draft, selectedDates, customAllocation }`. On success, refresh the assignment list and Today task data through the existing flow.

- [ ] **Step 4: Verify behavior and production build**

Run `npm run check` and `npm run build`. Expected: typecheck, tests, and build pass.

- [ ] **Step 5: Capture visual evidence**

Use Playwright with installed Chrome to capture phone and desktop screenshots of the expanded custom editor. Confirm the bottom navigation does not cover controls and differently sized sources display different maxima. Show screenshots to Hashim and wait for approval before committing.
