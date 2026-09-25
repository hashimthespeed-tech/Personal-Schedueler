# Recurring Commitments Design

## Goal

Add prayers, wrestling, and workouts to Today as recurring, checkable commitments while preserving the existing scheduler, interface, saved tasks, schoolwork, goals, and statistics.

## Scope

One pure date-based module will define every recurring item and its corresponding scheduling block. Both the planner frame and Today API will consume this shared source so displayed commitments always match protected time.

Visible recurring commitments:

- Fajr every day from 6:05–6:17 AM.
- Dhuhr + Asr for 12 minutes after the after-school arrival buffer: 4:25 PM on normal school days and 6:15 PM on Tuesday/Thursday wrestling days. On weekends and school-closure dates, its start follows the existing calculated Dhuhr/Asr prayer time.
- Maghrib + Isha every day from 7:00–7:12 PM.
- Wrestling Tuesday and Thursday from the end of period seven until the existing 5:30 PM home time.
- Workout Monday, Friday, Saturday, and Sunday for 30 minutes, preferred at 5:30 PM. It is flexible and may only be shortened through the existing explicit tradeoff approval flow.

Wednesday has no workout. Tuesday and Thursday wrestling replaces it.

Hidden protected time remains absent from Today while blocking placement:

- School preparation from 7:40 AM until the existing morning commute.
- Existing school, commute, class, passing-period, and lunch blocks.
- A 30-minute arrival/meal/settling buffer on normal school days.
- A 45-minute shower/meal/settling buffer after wrestling.
- Phone-off and sleep preparation from 9:00–10:00 PM.

The normal scheduling cutoff is 9:00 PM. Only schoolwork explicitly due the next day may use the 9:00–10:45 PM emergency window. Work from 9:00–10:00 reports lost wind-down time, work after 10:00 reports lost sleep, and every such proposal still requires approval. Nothing may end after 10:45 PM. Prayer remains non-negotiable.

## Persistence and UI

Recurring items are computed, not inserted into `scheduled_tasks_v2`. Completion uses one `routine_log` row keyed by date and recurring slot key. `GET /api/tasks` returns saved tasks, recurring items, and the shared frame. A validated recurring-mark action toggles only recurring items valid for the requested date.

Today merges saved tasks and recurring commitments chronologically. Recurring cards reuse the current task-card appearance and checkbox. They have no Move control. Hidden blocks never appear as cards.

## Compatibility

No database migration is required. Existing task IDs, assignment splitting, exact-minute durations, overdue/moved handling, goals, Week, Due, Stats, authentication, and navigation remain unchanged. Existing saved tasks continue to use their current API and table.

## Verification

Pure tests cover weekday recurrence, exact prayer times, Wednesday rest, weekend behavior, hidden buffers, morning availability, normal cutoff, next-day-only emergency placement, the 10:45 PM hard cap, and chronological merging. API-facing helpers validate recurring completion keys. The full typecheck, Vitest suite, and production build must pass. Phone and desktop Playwright screenshots of Today require Hashim’s approval before commit, merge, push, or deployment.
