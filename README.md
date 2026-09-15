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

Complete and verified end-to-end against Postgres: seed, solve, render, check in.
86 tests pass.

| Area | State |
|---|---|
| Prayer times (Jafari) | done, tested |
| Sleep model + bedtime ramp | done, tested |
| Slot builder | done, tested |
| Stage A solver | done, tested |
| Training program, progression, volume gating | done, tested |
| Database schema + seed | done |
| Four specialists + Stage B review | done |
| PWA: today, week, check-in, capture, stats, settings | done |
| Desktop hub for agent conversations | done |
| Completion tracking, goal progress, statistics | done |
| Task and schedule management / reset | done |
| Web push | done — needs an installed PWA on iOS |

## Setup

```bash
npm install
cp .env.example .env          # then fill in DATABASE_URL and ANTHROPIC_API_KEY
npx web-push generate-vapid-keys   # paste into .env
npm run db:push               # create tables
npm run db:seed               # load the real schedule
npm run dev
```

`.env.example` is committed; `.env` is not. Keys belong in `.env` locally, or in
your host's environment variables when deployed — never in a tracked file.

## Commands

```
npm run test        # vitest
npm run typecheck   # tsc --noEmit
npm run check       # both
npm run dev         # next dev
npm run db:check    # diagnose the database connection
npm run db:push     # apply schema
npm run db:seed     # load courses, bells, settings, starter goals
```

## Phone and laptop do different jobs

The phone captures and shows the day: photograph an assignment and it becomes
scheduled work, see what is next, tick things off, check in at night. The
conversations — being tutored, working through a training question — live in
the hub at `/hub`, which is desktop-only in the navigation.

`/hub` still resolves on a phone if you follow a link. Hiding it is about not
promoting the worse path, not locking a door: being tutored through a soft
keyboard is a worse version of something that is fine on a laptop.

## Scheduling behaviour

Two caps shape the week. The **per-day cap** (60% of that day's own free time)
is the operative one and the thing to change if plans feel too light or heavy;
the weekly cap is a backstop that only binds if the daily cap is raised.

Tasks are placed **least-slack-first** — the free capacity a task could legally
use, minus what it needs. This subsumes deadline urgency rather than competing
with it, because slots past a deadline are not eligible.

When something doesn't fit, `unplaced` says why, and the reasons are
distinguishable: a day already at its cap reports `day_at_capacity`, which is a
different problem from `no_slot_long_enough` and reads very differently on a
screen showing visibly empty time.

Weekend capacity is the weakest number in the model. Weekdays subtract school,
practice and commute; a weekend day subtracts only sleep, meals and prayer, so
its free time is overstated. Adding real weekend commitments fixes that
properly.

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
