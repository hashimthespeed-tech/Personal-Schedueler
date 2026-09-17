# Meal calorie tracking and stats tabs — design

## Goal

Let the Personal Scheduler record whether each scheduled meal was eaten, optionally record its calories later, and show an honest daily-calorie graph. Restructure `/stats` into a default **Graphs** tab and a **Numbers** tab.

## Scope

- Treat every meal slot already present in the fixed routine as trackable.
- A meal can be marked done (eaten) or missed using the existing routine-log interaction.
- When a meal is marked done, reveal an optional whole-number calorie field. It starts blank.
- A calorie value can be added or edited later without changing the meal's done/missed status.
- Add a daily-calorie graph to the default **Graphs** tab on `/stats`.
- Move the existing per-slot numerical summaries to a **Numbers** tab.
- Keep the existing consistency grid and intensity charts in **Graphs**.

## Data model

Extend the existing `routine_log` row for a slot and day with a nullable integer calorie value.

Calories belong only to meal slots. Existing non-meal rows keep their current behavior, including their optional intensity rating. A value must be an integer greater than or equal to zero.

## Today interaction

1. A meal row gets the normal done and missed controls.
2. Marking it done reveals a compact, optional calories field directly below or within that row.
3. Leaving the field blank is valid, allowing the meal to be checked off immediately and completed later.
4. Saving an entered or edited value updates the existing log row for that meal and day.
5. Marking a meal missed clears or ignores any calorie value so it cannot contribute to that day's intake.

## Daily-calorie graph

For each date in the selected stats window, calculate a total only when the day's meal tracking is complete:

- every scheduled meal has a final state (done or missed); and
- every meal marked done has a calorie value.

The total is the sum of calorie values for meals marked done. A missed meal contributes zero only once it is explicitly marked missed.

If the day is incomplete, or an eaten meal has no calorie value, emit no observation for that date. The chart must render a visible gap rather than a zero or a connected line through the missing day.

## Stats tabs

- **Graphs** is selected on first load. It includes the existing consistency grid, intensity charts, and the new daily-calorie chart.
- **Numbers** contains existing aggregate counts, rates, averages, and the per-slot table.
- The selected tab changes presentation only; the date-range and underlying stats data remain shared.

## Error handling

- Reject invalid calories at the server boundary and show a plain inline error without losing the meal's current done/missed state.
- No entry is backfilled for historic days. Their calorie chart points remain gaps unless the user fills the meal records.
- The feature must never turn missing calories into zero.

## Tests

Add focused tests for:

- meal rows accepting done/missed plus nullable calories;
- calorie validation and later edits;
- daily totals for complete days;
- missed meals contributing zero after explicit confirmation;
- a graph gap for an unanswered meal or an eaten meal without calories;
- retained gaps rather than interpolated chart lines;
- default selection of **Graphs** and correct content separation between the two stats tabs.
