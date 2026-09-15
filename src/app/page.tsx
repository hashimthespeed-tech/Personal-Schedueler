import { desc, eq } from "drizzle-orm";
import { db } from "@/db/index";
import { blocks, completions, goals, planReviews, unplaced } from "@/db/schema";
import { prayerBlocks } from "@/core/prayer";
import { sleepNightFor, bedtimeFor } from "@/core/sleep";
import { today } from "@/agents/context";
import { to12h } from "@/core/types";
import { requireSession } from "@/lib/auth";
import { InstallHint } from "@/components/InstallHint";
import { BlockCard } from "@/components/BlockCard";
import { GoalProgress } from "@/components/GoalProgress";
import { statsByDomain, statsByGoal, datesInRange } from "@/core/stats";
import { gte } from "drizzle-orm";
import { DateTime } from "luxon";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  await requireSession();

  const date = today();
  const weekStart = datesInRange(date, 7)[0] ?? date;
  const [todayBlocks, notFitting, latestReview, activeGoals, weekCompletions] = await Promise.all([
    db.select().from(blocks).where(eq(blocks.onDate, date)).orderBy(blocks.startMin),
    db.select().from(unplaced).orderBy(desc(unplaced.createdAt)).limit(6),
    db.select().from(planReviews).orderBy(desc(planReviews.createdAt)).limit(1),
    db.select().from(goals).where(eq(goals.active, true)),
    db.select().from(completions).where(gte(completions.onDate, weekStart)),
  ]);

  const records = weekCompletions.map((c) => ({
    onDate: c.onDate,
    domain: c.domain,
    goalId: c.goalId,
    minutes: c.minutes,
    skipped: c.skipped,
    completedAt: c.completedAt,
    plannedStartMin: c.plannedStartMin,
  }));
  const goalStats = statsByGoal(records, activeGoals.map((g) => ({ id: g.id, weeklyTarget: g.weeklyTarget })), 1);
  const domainStats = statsByDomain(records, date);

  const prayers = prayerBlocks(date);
  const night = sleepNightFor(date);
  const bedtime = bedtimeFor(date);
  const review = latestReview[0];

  const nowMin = DateTime.now().setZone("America/Los_Angeles").hour * 60 +
    DateTime.now().setZone("America/Los_Angeles").minute;
  const next = todayBlocks.find((b) => b.endMin > nowMin);

  return (
    <div className="pt-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">
          {DateTime.fromISO(date).toFormat("cccc")}
        </h1>
        <p className="dim text-sm">{DateTime.fromISO(date).toFormat("d LLLL")}</p>
      </header>

      <InstallHint />

      {next && (
        <section className="card mb-4 p-4">
          <p className="dim text-[11px] font-medium uppercase tracking-wide">Up next</p>
          <p className="mt-1 text-lg font-semibold">{next.title}</p>
          <p className="dim text-sm">
            {to12h(next.startMin)} – {to12h(next.endMin)}
          </p>
        </section>
      )}

      {review && (
        <section className="card mb-4 p-4">
          <p className="dim text-[11px] font-medium uppercase tracking-wide">From last night's review</p>
          <p className="mt-1 text-sm leading-relaxed">{review.summary}</p>
        </section>
      )}

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold">Prayer</h2>
        <div className="card divide-y" style={{ borderColor: "var(--line)" }}>
          {prayers.map((p) => (
            <div key={p.name} className="flex items-baseline justify-between px-4 py-2.5">
              <span className="text-sm font-medium">{p.label}</span>
              <span className="dim text-sm tabular-nums">
                {to12h(p.start)}
                <span className="opacity-60"> · until {to12h(p.window.end)}</span>
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold">Schedule</h2>
        {todayBlocks.length === 0 ? (
          <p className="dim card p-4 text-sm">
            Nothing scheduled. Talk to an agent, or run a replan.
          </p>
        ) : (
          <ul className="space-y-2">
            {todayBlocks.map((b) => (
              <BlockCard
                key={b.id}
                past={b.endMin <= nowMin}
                block={{
                  id: b.id,
                  title: b.title,
                  domain: b.domain,
                  startMin: b.startMin,
                  endMin: b.endMin,
                  notes: b.notes,
                  steps: b.steps,
                  chunkIndex: b.chunkIndex,
                  chunkCount: b.chunkCount,
                  completed: b.completed,
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {activeGoals.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-2 text-sm font-semibold">Goals this week</h2>
          <GoalProgress
            goals={activeGoals.map((g) => {
              const stat = goalStats.find((x) => x.goalId === g.id);
              const domain = domainStats.find((d) => d.domain === g.domain);
              return {
                id: g.id,
                domain: g.domain,
                northStar: g.northStar,
                weeklyTarget: g.weeklyTarget,
                done: stat?.done ?? 0,
                progress: stat?.progress ?? null,
                streak: domain?.streak ?? 0,
              };
            })}
          />
        </section>
      )}

      {notFitting.length > 0 && (
        <section className="mb-5">
          <h2 className="mb-1 text-sm font-semibold">Didn't fit this week</h2>
          <p className="dim mb-2 text-xs">
            Better to know now than on Thursday.
          </p>
          <ul className="space-y-2">
            {notFitting.map((u) => (
              <li key={u.id} className="card p-3">
                <p className="text-sm font-medium">{u.title}</p>
                <p className="dim mt-0.5 text-xs">{u.detail}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-2 text-sm font-semibold">Sleep</h2>
        <div className="flex items-baseline justify-between text-sm">
          <span className="dim">Bedtime tonight</span>
          <span className="font-medium tabular-nums">{to12h(bedtime)}</span>
        </div>
        <div className="mt-1 flex items-baseline justify-between text-sm">
          <span className="dim">Last night, net</span>
          <span className="font-medium tabular-nums">
            {(night.netSleepMin / 60).toFixed(1)}h
          </span>
        </div>
        <p className="dim mt-2 text-xs leading-relaxed">
          {night.vsTargetMin < 0
            ? `${(Math.abs(night.vsTargetMin) / 60).toFixed(1)}h under target. Fajr costs ${night.interruptionMin} min — the bedtime is what closes the gap.`
            : `On target, after the ${night.interruptionMin} min Fajr wake.`}
        </p>
      </section>
    </div>
  );
}
