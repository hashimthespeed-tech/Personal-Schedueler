# Custom Trade-off Editor Design

## Purpose

When schoolwork cannot fit before its deadline, Hashim can edit one proposed plan instead of accepting only preset choices. He distributes the exact shortage across adjustable tasks and routines, then approves the result.

## Interaction

- “Edit my own plan” opens a phone-first editor below the preset options.
- One five-minute slider appears for each reducible item on each affected day.
- A live counter shows how many minutes still need to be found.
- Approval is disabled until the selected reductions equal the shortage exactly.
- Reductions shorten the selected item only for that day. They do not silently create new work on another day.

## Per-task isolation

Every source has a stable ID containing its date and task/block ID. Its original duration, safe minimum, and maximum reduction are calculated independently. Labels are presentation only, so two items with identical names cannot share values or overwrite one another.

Examples:

- A 60-minute workout with a 40-minute minimum allows 0–20 minutes.
- A 30-minute study block with a 20-minute minimum allows 0–10 minutes.
- Sleep uses that night’s planned duration and a hard 420-minute minimum.

## Safety and approval

School, prayer, commute, and other protected blocks never appear as controls. Every submitted allocation is recomputed and validated on the server. It must reference each source at most once, use five-minute increments, stay within that source’s maximum, and exactly cover the shortage. If the schedule changed after preview, approval is rejected and a fresh preview is required.

## Persistence and scoring

Approved reductions are stored with the schoolwork sessions as explicit costs tied to their source block. The schoolwork total never changes. Completing or moving the resulting sessions follows the existing Today and daily-completion rules.

## Verification

Unit tests cover unequal task durations, duplicate labels with distinct IDs, over-limit allocations, duplicate source IDs, incorrect totals, sleep minimums, and exact session totals. Phone and desktop screenshots are required before committing the UI.
