export interface GoalRow {
  id: number;
  domain: string;
  northStar: string;
  weeklyTarget: number | null;
  done: number;
  progress: number | null;
  streak: number;
}

/**
 * Progress per goal for the current week.
 *
 * A goal with no weekly target shows a count rather than a bar — an invented
 * denominator would make the bar meaningless, and a bar that always reads
 * "some" is worse than a number.
 */
export function GoalProgress({ goals }: { goals: GoalRow[] }) {
  return (
    <ul className="space-y-2">
      {goals.map((g) => {
        const pct = g.progress === null ? null : Math.round(g.progress * 100);
        return (
          <li key={g.id} className="card p-3">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{g.northStar}</span>
              <span className="dim shrink-0 text-xs tabular-nums">
                {g.weeklyTarget ? `${g.done}/${g.weeklyTarget}` : `${g.done} done`}
              </span>
            </div>

            {pct !== null && (
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: "var(--line)" }}
                role="progressbar"
                aria-valuenow={pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={g.northStar}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: `var(--color-${g.domain})` }}
                />
              </div>
            )}

            {g.streak > 1 && (
              <p className="dim mt-1.5 text-xs">{g.streak} days running</p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
