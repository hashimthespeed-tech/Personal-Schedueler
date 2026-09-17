# Personal Scheduler

A fixed daily routine, a tick against each thing that matters, and the graphs
that fall out of doing that for a few weeks.

## What it is, and what it stopped being

It used to be four LLM specialists emitting tasks into a deterministic solver
that packed them into the week. That is gone. Two things killed it:

- **The solver was solving the wrong problem.** Teachers here hand out work one
  or two days ahead, much of it off a whiteboard. There is no known future
  workload to spread, so a planner that reshuffles the week every night was
  rearranging guesses. What actually fails is *capture*, not planning.
- **A schedule that moves cannot be scored.** "You missed Tuesday's lift" was
  ambiguous — missed the block, or was the block never placed? With the same
  shape every day, a miss is a miss and the arithmetic is honest.

So the day is now a pure function. Same slots every morning, no overnight
replanning, nothing to approve before you can act.

```
core/routine.ts     the day, as a pure function of the date
      |             (one computed value: Maghrib, which swings three hours
      |              across the year and is inserted out of band)
      v
routine_log         one row per slot per day: done | missed, and an
      |             optional 1-10 rating
      v
core/consistency.ts rates, streaks, the grid, the intensity series
```

`core/` has no database and no framework in it, so the whole model is testable
without either.

## The day

Four core hours, every day: **Islam · school work · training · business & AI.**
Everything else in the routine exists to make those four survivable — a shower
after training, food before school work, and the build hour last on purpose,
because it is the one he wants to do and so it survives being tired.

Wake is 06:00 and lights out is 22:00 (06:30 / 22:30 at the weekend). The
morning has no slack at all: 06:00–08:05 is 125 minutes and all of it is spent.

Practice is Tuesday and Thursday; lifting is Monday, Wednesday, Friday and
Saturday. The routine does not know what the training *is* — that is tracked in
a separate app. It only knows the hour it takes.

## Tracking

A tick or a cross against each tracked slot. After a tick on one of the four
core hours, an optional 1–10 rating appears inline; skipping it costs nothing.
A prompt that blocked the tick would be seven prompts a day, which is how a
sixty-second loop becomes a five-minute one nobody does.

`/stats` reads that log three ways:

- **the grid** — every tracked slot against every day, so a row that is empty
  on Thursdays shows a pattern no percentage can
- **the intensity lines** — only the sessions that were rated, drawn with real
  gaps rather than straight lines through days with no data
- **the numbers** — done, missed, skipped and average per slot

Two scoring decisions worth knowing. The rate is done over *scheduled*, so an
unanswered day counts against you — but it is reported separately as `silent`,
because "did not answer" and "failed" are different things. And the window
never starts before the first day anything was logged: asking for a fortnight
on day two used to count twelve days of pre-history as misses and report 8%.

## Tutoring lives outside the app

There is no API key here and nothing costs money to run. A Claude.ai
subscription does not include API credits — they are separate products with
separate billing — so every hub message used to bill per token against a
budget that does not exist. Subject tutoring moved to Claude.ai Projects,
which are the same idea, run on a better model, and already have a camera and
a microphone in the mobile app.

## Setup

```bash
npm install
cp .env.example .env               # then fill in DATABASE_URL and APP_PASSPHRASE
npx web-push generate-vapid-keys   # paste into .env
npm run db:check                   # confirm the connection before anything else
npm run db:push                    # create tables
npm run db:seed                    # load the real schedule
npm run dev
```

`.env.example` is committed; `.env` is not. Secrets belong in `.env` locally,
or in your host's environment variables when deployed — never in a tracked
file.

`db:check` exists because `db:push` hides connection failures: it prints
"Pulling schema from database…", exits without an error, and creates nothing.

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

## Status

73 tests pass. Typecheck and build are clean.

| Area | State |
|---|---|
| Prayer times (Jafari) | done, tested |
| Fixed routine | done, tested — every waking minute accounted for |
| Consistency, streaks, intensity | done, tested |
| Stats: grid, intensity chart, per-slot table | done |
| Assignment capture (four taps, no model) | done |
| Sleep logged the morning after | done |
| Database schema + seed | done |
| Web push | **subscribes only — nothing sends yet** |

The push gap is real: `vercel.json` has no cron and nothing calls
`lib/push.ts`, so enabling reminders registers the device and stops there. The
settings screen says so rather than promising a nudge that never arrives. An
evening "you have not marked today" is the one notification this app wants.

## Configuration notes

**Prayer times** use `adhan` with explicit Jafari parameters (Fajr 16°, Isha
14°, Maghrib 4°) rather than a shipped preset. The Maghrib angle matters:
adhan defaults Maghrib to sunset, which is the Sunni convention, and the Shia
position puts it roughly 15 minutes later. `tests/prayer.test.ts` asserts the
offset so a silent regression cannot pass.

Five times are computed, then grouped into the three observed blocks: Fajr,
Dhuhr+Asr, Maghrib+Isha. Maghrib is the only part of the day that moves — 4:58
PM in December, 8:17 PM in June — so it is inserted into the timeline out of
band rather than being a fixed slot.

**Sleep** is one wake. Fajr enters before 06:00 every day of the year at this
latitude, but its window stays open until sunrise, and sunrise is after 06:00
from August through **1 May** — so Fajr is prayed on getting up and nothing is
deducted from the night. From 2 May sunrise beats the alarm, and the last six
weeks of school need an earlier wake; `routine.wake` is a config field for
exactly that. `tests/sleep.test.ts` pins the whole claim, including the date it
breaks.

There used to be a bedtime ramp here, walking 23:00 toward 21:40 at fifteen
minutes a week. It belonged to the solver, which needed a bedtime it could
compute. The routine fixes lights out, so the ramp only meant Settings and
Today disagreed about bedtime.
