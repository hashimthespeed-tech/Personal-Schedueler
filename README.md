# Personal Scheduler

A goal manager that holds school, deen, AI projects, money projects and
physique in one place and produces a single schedule across all of them.

## Architecture

Specialists decide **what** needs to happen. The scheduler decides **when**.
Nothing else writes time.

```
Specialists (LLM)      Coach · Tutor · Ustadh · Builder
  read shared state, emit tasks with constraints
        |
        v  tasks — the integration contract
Scheduler              Stage A: deterministic solver (no LLM)
                       Stage B: LLM review over Stage A's output
  the only writer of blocks
        |
        v
Shared state (Postgres)
```

### Why the scheduler is split in two

Packing time against hard constraints is arithmetic. A language model asked to
emit a schedule directly produces overlapping blocks and silently drops
constraints, and its output cannot be diffed or trusted. So Stage A is pure
TypeScript, and the LLM only makes judgment calls over its result.

The most useful output is not `blocks` — it is `unplaced`, with a reason per
item. That surfaces an overcommitted week before it starts.

## Status

| Area | State |
|---|---|
| Prayer times (Jafari) | done, tested |
| Sleep model + bedtime ramp | done, tested |
| Slot builder | done |
| Stage A solver | done, tests pending |
| Training program + progression + gating | done, tests pending |
| Database, UI, push, agents | not started |

## Commands

```
npm run test        # vitest
npm run typecheck   # tsc --noEmit
npm run check       # both
npm run dev         # next dev
```

## Configuration notes

**Prayer times** use `adhan` with explicit Jafari parameters (Fajr 16 deg,
Isha 14 deg, Maghrib 4 deg) rather than a shipped preset. The Maghrib angle
matters: adhan defaults Maghrib to sunset, which is the Sunni convention, and
the Shia position puts it roughly 15 minutes later. `tests/prayer.test.ts`
asserts the offset so a silent regression cannot pass.

Five times are computed, then grouped into the three observed blocks:
Fajr, Dhuhr+Asr, Maghrib+Isha.

**Sleep** has two distinct wake concepts, and conflating them gives wrong
totals: `dayStart` (06:00, fixed by school) and `fajrWake` (computed daily, a
brief interruption before returning to sleep). At this latitude Fajr ranges
04:11 to 05:55 and never reaches 06:00, so the interruption applies every day
of the year.

Bedtime is the only variable that can repay sleep debt, so it ramps 15
min/week from 23:00 toward 21:40 and the solver treats it as a hard wall.

**Utilization** is capped at 70% of free time. A schedule that fills every
waking minute is one nobody follows.
