import { desc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db/index";
import { blocks, checkIns, planReviews, prayerLog, settings, unplaced } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { today } from "@/agents/context";
import { buildTimeline } from "@/core/timeline";
import { weekdayOf } from "@/core/slots";
import { fajrInterruptionFor, DEFAULT_SLEEP } from "@/core/sleep";
import { InstallHint } from "@/components/InstallHint";
import { Timeline } from "@/components/Timeline";
import { SleepCard } from "@/components/SleepCard";
import { checkSchema } from "@/lib/schema-guard";
import { SetupNeeded } from "@/components/SetupNeeded";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  await requireSession();

  // A deploy without db:push makes every query fail, and production strips the
  // message — so without this the whole app is a blank "server error".
  const schema = await checkSchema();
  if (!schema.ok) return <SetupNeeded status={schema} />;

  const date = today();
  const weekday = weekdayOf(date);

  const [todayBlocks, notFitting, latestReview, todayCheckIn, todayPrayers, settingsRow] =
    await Promise.all([
      db.select().from(blocks).where(eq(blocks.onDate, date)).orderBy(blocks.startMin),
      db.select().from(unplaced).orderBy(desc(unplaced.createdAt)).limit(5),
      db.select().from(planReviews).orderBy(desc(planReviews.createdAt)).limit(1),
      db.select().from(checkIns).where(eq(checkIns.onDate, date)).limit(1),
      db.select().from(prayerLog).where(eq(prayerLog.onDate, date)),
      db.select().from(settings).limit(1),
    ]);

  const now = DateTime.now().setZone(settingsRow[0]?.timezone ?? "America/Los_Angeles");
  const nowMin = now.hour * 60 + now.minute;

  const items = buildTimeline({
    date,
    weekday,
    blocks: todayBlocks.map((b) => ({
      id: b.id,
      title: b.title,
      domain: b.domain,
      startMin: b.startMin,
      endMin: b.endMin,
      completed: b.completed,
      chunkIndex: b.chunkIndex,
      chunkCount: b.chunkCount,
    })),
  });

  const state = {
    blocks: Object.fromEntries(todayBlocks.map((b) => [String(b.id), b.completed])),
    prayers: Object.fromEntries(todayPrayers.map((p) => [p.block, p.status])),
    detail: Object.fromEntries(
      todayBlocks.map((b) => [String(b.id), { notes: b.notes, steps: b.steps }]),
    ),
  };

  const review = latestReview[0];
  const checkIn = todayCheckIn[0];
  const scheduled = todayBlocks.length;

  return (
    <div className="pt-6">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">{now.toFormat("cccc")}</h1>
        <p className="dim text-sm">
          {now.toFormat("d LLLL")}
          {scheduled > 0 && ` · ${scheduled} scheduled`}
        </p>
      </header>

      <InstallHint />

      {review && (
        <section className="card mb-4 p-4">
          <p className="dim text-[11px] font-medium uppercase tracking-wide">
            From last night&apos;s review
          </p>
          <p className="mt-1 text-sm leading-relaxed">{review.summary}</p>
        </section>
      )}

      <div className="mb-5">
        <SleepCard
          date={date}
          bedtimeMin={checkIn?.bedtimeMin ?? null}
          wakeMin={checkIn?.wakeMin ?? null}
          fajrInterruptionMin={fajrInterruptionFor(date)}
          targetSleepMin={settingsRow[0]?.targetSleepMin ?? DEFAULT_SLEEP.targetSleepMin}
        />
      </div>

      <section className="mb-5">
        <Timeline date={date} items={items} state={state} nowMin={nowMin} />
      </section>

      {scheduled === 0 && (
        <p className="dim card mb-5 p-4 text-sm">
          Nothing scheduled yet — the day above is just its shape. Talk to an agent on the hub,
          or photograph something in Capture.
        </p>
      )}

      {notFitting.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-semibold">Didn&apos;t fit this week</h2>
          <p className="dim mb-2 text-xs">Better to know now than on Thursday.</p>
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
    </div>
  );
}
