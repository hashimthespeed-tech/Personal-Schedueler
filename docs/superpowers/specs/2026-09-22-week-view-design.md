# Week View Design

## Purpose

Add a phone-first Week page that makes the complete schedule easy to inspect and adjust without creating a second copy of the plan. Today and Week must always read and mutate the same dated task rows.

## Approved interaction

- The page shows Monday through Sunday across the top.
- Today is selected when the current week opens; otherwise the first day is selected.
- One selected day's timeline is shown at a time.
- The timeline merges scheduled tasks with protected day-frame blocks in time order.
- Split school assignments remain separate dated sessions and show their duration and role.
- Tapping an editable task opens a small sheet without leaving Week.
- The sheet can mark the task done, change its duration, or move it to another day.
- Duration and move changes are previewed through the existing placement engine. No mutation occurs until Hashim approves an exact option and its costs.
- Prayer, school, commute, sleep, and other generated protected blocks are visible but cannot be edited from Week.
- Phone navigation has five direct destinations: Today, Due, Week, Goals, and Stats.

## Data model and consistency

The Week page reads `scheduled_tasks_v2` for an inclusive Monday-to-Sunday range. It does not store a weekly projection or duplicate task data. Each day's generated frame comes from `buildDayFrame`.

Task identity remains the database task ID. Same-named tasks never share state. Completing a task uses the existing mark action. Moving a task keeps the existing historical semantics: the source occurrence becomes `moved` and a new occurrence is created on the approved day. A same-day duration edit updates the existing occurrence only after the server recomputes and validates its placement with that source task excluded from collision checks.

An assignment-generated session may be resized as an individual scheduled occurrence; its parent assignment's original estimate remains the planning estimate and is not silently rewritten.

## Server interface

`GET /api/week?date=YYYY-MM-DD` returns:

- `weekStart` and `weekEnd`
- seven day payloads in date order
- each day's generated frame
- all scheduled task rows for that date, including moved history for truthful completion reporting

The task API gains preview and approval actions for editing an unfinished occurrence. The server owns the task's title, kind, due date, assignment identity, and test role. The client may request only a new duration, day, placement mode, and optional fixed start. Approval succeeds only if the submitted option exactly matches a freshly recomputed option.

Test refresher constraints, due dates, protected blocks, sleep limits, and explicit sacrifice approval remain enforced.

## UI states

- Loading and request errors use concise inline messages.
- An empty day says that no tasks are assigned and still displays its protected anchors.
- Untimed overdue tasks appear in a separate section for that selected day.
- Done tasks remain visible and can be unmarked.
- Moved source rows are summarized as moved, excluded from that day's completion percentage, and are not editable.
- The edit sheet resets stale preview options whenever the day, duration, mode, or start time changes.

## Testing and visual verification

Automated tests cover Monday/Sunday boundaries, day ordering, unique task identity, same-day resize validation, moving before due dates, protected test refreshers, exact server approval, and Today/Week consistency. Type-check, the full test suite, and the production build must pass.

Before committing the UI, capture Playwright screenshots of `/week?preview=1` at phone and desktop sizes and wait for Hashim's explicit visual approval.
