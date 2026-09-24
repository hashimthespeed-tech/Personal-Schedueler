# Exact-Minute Schoolwork Design

## Goal

Allow schoolwork entered on the Due page to use any positive whole-minute estimate, while preserving every existing scheduling, priority, sleep, test-preparation, and approval rule.

## Behavior

- Estimated minutes accept every integer from 1 through 600.
- The scheduler preserves the entered total exactly. It never rounds, duplicates, or drops minutes when work is split across days or windows.
- Normal assignments keep the same day-selection, latest-day recommendation, daily workload cap, clean-time-first behavior, and tradeoff approval flow.
- Tests still require exactly two selected days, including the day before as the refresher. For short tests, both days receive at least one minute; the refresher remains approximately 25% of the total and is capped at 30 minutes.
- Existing sacrifice priorities remain unchanged: clean time first, then the same flexible-block strategies, with sleep considered only for urgent work and never below seven hours.
- Custom tradeoff controls move in one-minute steps so an odd-minute shortfall can be resolved exactly.
- Zero, negative, fractional, and over-600-minute estimates remain invalid.

## Implementation

The Due form and schoolwork API will change their minimum and step validation from 15/5 minutes to 1 minute. The schoolwork planning core will replace five-minute rounding and allocation increments with exact integer-minute calculations. No unrelated task-entry or Week-page duration behavior will change.

## Verification

Automated tests will cover one-minute work, odd-minute splitting, exact totals, short-test two-day allocation, exact custom tradeoffs, and preservation of the existing schoolwork suite. The Due page will be checked at phone and desktop sizes before release.
