import { gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db/index";
import { checkIns, completions, goals } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { today } from "@/agents/context";
import {
  statsByDomain, statsByGoal, overallScore, dailyCounts, datesInRange, DOMAIN_ORDER,
} from "@/core/stats";
import { StatTile, BarChart, DailyBars, LineChart } from "@/components/Charts";
import { domainColor, domainLabel } from "@/lib/domains";
import { StatsRange } from "@/components/StatsRange";

export const dynamic = "force-dynamic";

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireSession();

  const { days: daysParam } = await searchParams;
  const days = daysParam === "7" ? 7 : daysParam === "90" ? 90 : 30;
  const date = today();
  const from = datesInRange(date, days)[0] ?? date;

  const [completionRows, checkInRows, goalRows] = await Promise.all([
    db.select().from(completions).where(gte(completions.onDate, from)),
    db.select().from(checkIns).where(gte(checkIns.onDate, from)).orderBy(checkIns.onDate),
    db.select().from(goals).where(gte(goals.id, 0)),
  ]);

  const records = completionRows.map((c) => ({
    onDate: c.onDate,
    domain: c.domain,
    goalId: c.goalId,
    minutes: c.minutes,
    skipped: c.skipped,
    completedAt: c.completedAt,
    plannedStartMin: c.plannedStartMin,
  }));

  const domainStats = statsByDomain(records, date);
  const score = overallScore(domainStats);
  const weeks = days / 7;
  const goalStats = statsByGoal(records, goalRows.map((g) => ({ id: g.id, weeklyTarget: g.weeklyTarget })), weeks);
  const daily = dailyCounts(records, date, Math.min(days, 42));

  const totalDone = records.filter((r) => !r.skipped).length;
  const totalMinutes = records.filter((r) => !r.skipped).reduce((n, r) => n + r.minutes, 0);
  const bestStreak = Math.max(0, ...domainStats.map((d) => d.streak));

  const energySeries = datesInRange(date, Math.min(days, 42)).map((d) => ({
    date: d,
    value: checkInRows.find((c) => c.onDate === d)?.energy ?? null,
  }));
  const sleepSeries = datesInRange(date, Math.min(days, 42)).map((d) => {
    const min = checkInRows.find((c) => c.onDate === d)?.sleepMin;
    return { date: d, value: min == null ? null : min / 60 };
  });

  const ordered = DOMAIN_ORDER.map((d) => domainStats.find((s) => s.domain === d)).filter(
    (s): s is NonNullable<typeof s> => Boolean(s),
  );

  return (
    <div className="pt-6">
      <header className="mb-1 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Stats</h1>
        <StatsRange current={days} />
      </header>
      <p className="dim mb-5 text-sm">
        Built from what you actually marked done, not from what was planned.
      </p>

      {records.length === 0 ? (
        <p className="dim card p-4 text-sm">
          Nothing recorded yet. Mark a block done on the Today tab and it starts here.
        </p>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3">
            <StatTile
              label="Consistency"
              value={score === null ? "—" : `${Math.round(score * 100)}%`}
              sub="mean across domains"
            />
            <StatTile label="Completed" value={String(totalDone)} sub={`${(totalMinutes / 60).toFixed(1)}h logged`} />
          </div>

          {bestStreak > 1 && (
            <StatTile label="Longest current streak" value={`${bestStreak} days`} />
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold">Consistency by goal area</h2>
            <p className="dim mb-2 text-xs">Of what was scheduled, how much got done.</p>
            <BarChart
              rows={ordered.map((s) => ({
                key: s.domain,
                label: domainLabel(s.domain),
                value: s.consistency ?? 0,
                display: s.consistency === null ? "—" : `${Math.round(s.consistency * 100)}% · ${s.done}/${s.done + s.skipped}`,
                color: domainColor(s.domain),
              }))}
            />
          </section>

          {goalRows.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold">Goals</h2>
              <BarChart
                max={1}
                rows={goalRows.map((g) => {
                  const stat = goalStats.find((x) => x.goalId === g.id);
                  const perWeek = ((stat?.done ?? 0) / weeks).toFixed(1);
                  return {
                    key: String(g.id),
                    label: g.northStar,
                    value: stat?.progress ?? 0,
                    display: g.weeklyTarget ? `${perWeek}/${g.weeklyTarget} per week` : `${stat?.done ?? 0} total`,
                    color: domainColor(g.domain),
                  };
                })}
              />
            </section>
          )}

          <section>
            <h2 className="mb-2 text-sm font-semibold">Completions per day</h2>
            <DailyBars data={daily} />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Energy</h2>
            <LineChart data={energySeries} min={1} max={5} suffix=" of 5" />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-semibold">Sleep</h2>
            <LineChart data={sleepSeries} min={4} max={10} suffix="h" decimals={1} />
          </section>

          {/* A table view is required, not optional: it is what makes the
              numbers readable without relying on colour at all. */}
          <section>
            <h2 className="mb-2 text-sm font-semibold">The numbers</h2>
            <div className="card overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="dim border-b" style={{ borderColor: "var(--line)" }}>
                    <th className="p-2 text-left font-medium">Area</th>
                    <th className="p-2 text-right font-medium">Done</th>
                    <th className="p-2 text-right font-medium">Skipped</th>
                    <th className="p-2 text-right font-medium">Hours</th>
                    <th className="p-2 text-right font-medium">Streak</th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((s) => (
                    <tr key={s.domain} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                      <td className="p-2">{domainLabel(s.domain)}</td>
                      <td className="p-2 text-right tabular-nums">{s.done}</td>
                      <td className="p-2 text-right tabular-nums">{s.skipped}</td>
                      <td className="p-2 text-right tabular-nums">{(s.minutes / 60).toFixed(1)}</td>
                      <td className="p-2 text-right tabular-nums">{s.streak}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <p className="dim text-xs">
            {DateTime.fromISO(from).toFormat("d LLL")} – {DateTime.fromISO(date).toFormat("d LLL")}
          </p>
        </div>
      )}
    </div>
  );
}
