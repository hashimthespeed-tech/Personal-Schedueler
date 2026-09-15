import { gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db/index";
import { blocks } from "@/db/schema";
import { today } from "@/agents/context";
import { to12h } from "@/core/types";
import { slotsForHorizon, totalMinutes } from "@/core/slots";
import { requireSession } from "@/lib/auth";
import { ReplanButton } from "@/components/ReplanButton";

export const dynamic = "force-dynamic";

export default async function WeekPage() {
  await requireSession();

  const start = today();
  const rows = await db.select().from(blocks).where(gte(blocks.onDate, start)).orderBy(blocks.onDate, blocks.startMin);

  const byDate = new Map<string, typeof rows>();
  for (const b of rows) {
    const list = byDate.get(b.onDate) ?? [];
    list.push(b);
    byDate.set(b.onDate, list);
  }

  const capacityMin = totalMinutes(slotsForHorizon(start, 7));
  const scheduledMin = rows.reduce((s, b) => s + (b.endMin - b.startMin), 0);
  const pct = capacityMin === 0 ? 0 : Math.round((scheduledMin / capacityMin) * 100);

  const days = Array.from({ length: 7 }, (_, i) =>
    DateTime.fromISO(start).plus({ days: i }).toISODate() ?? start,
  );

  return (
    <div className="pt-6">
      <header className="mb-4 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Week</h1>
        <ReplanButton />
      </header>

      <section className="card mb-5 p-4">
        <div className="flex items-baseline justify-between text-sm">
          <span className="dim">Scheduled</span>
          <span className="font-medium tabular-nums">
            {(scheduledMin / 60).toFixed(1)}h of {(capacityMin / 60).toFixed(1)}h free
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
          <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: "var(--fg)" }} />
        </div>
        <p className="dim mt-2 text-xs leading-relaxed">
          {pct}% booked. The solver stops at 70% on purpose — a week with every minute
          filled is a week nobody follows.
        </p>
      </section>

      <div className="space-y-5">
        {days.map((date) => {
          const list = byDate.get(date) ?? [];
          const dt = DateTime.fromISO(date);
          return (
            <section key={date}>
              <h2 className="mb-2 text-sm font-semibold">
                {dt.toFormat("cccc")}
                <span className="dim font-normal"> · {dt.toFormat("d LLL")}</span>
              </h2>
              {list.length === 0 ? (
                <p className="dim card px-3 py-2.5 text-xs">Clear</p>
              ) : (
                <ul className="space-y-1.5">
                  {list.map((b) => (
                    <li key={b.id} className={`card d-${b.domain} border-l-4 px-3 py-2`}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-sm">{b.title}</span>
                        <span className="dim shrink-0 text-xs tabular-nums">
                          {to12h(b.startMin)}–{to12h(b.endMin)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
