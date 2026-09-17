import { gte } from "drizzle-orm";
import { db } from "@/db/index";
import { routineLog } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { checkSchema } from "@/lib/schema-guard";
import { SetupNeeded } from "@/components/SetupNeeded";
import { consistency, windowEnding } from "@/core/consistency";
import { today } from "@/agents/context";

export const dynamic = "force-dynamic";

const RANGES = [7, 30, 90] as const;

/**
 * Consistency, which is the only number a fixed routine owes you.
 *
 * The old stats page could not produce this honestly: blocks moved every
 * night, so a gap might be a miss or might be a block that was never placed.
 * With the same slots every day, `done / scheduled` means exactly what it says.
 */
export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  await requireSession();

  const schema = await checkSchema();
  if (!schema.ok) return <div className="pt-6"><SetupNeeded status={schema} /></div>;

  const { days: asked } = await searchParams;
  const days = RANGES.find((r) => String(r) === asked) ?? 30;

  const date = today();
  const window = windowEnding(date, days);
  const rows = await db.select().from(routineLog).where(gte(routineLog.onDate, window.from));

  const score = consistency(
    window.from,
    window.to,
    rows.map((r) => ({
      onDate: r.onDate,
      slotKey: r.slotKey,
      status: r.status as "done" | "missed",
    })),
  );

  const core = score.slots.filter((s) => ["islam", "school-work", "train", "build"].includes(s.key));
  const rest = score.slots.filter((s) => !core.includes(s));

  return (
    <div className="space-y-5 pt-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Consistency</h1>
        <p className="dim text-sm">Same slots every day, so these numbers compare.</p>
      </header>

      <nav className="flex gap-1.5">
        {RANGES.map((r) => (
          <a
            key={r}
            href={`/stats?days=${r}`}
            className="rounded-full px-3 py-1.5 text-xs font-medium"
            style={
              r === days
                ? { background: "var(--fg)", color: "var(--bg)" }
                : { border: "1px solid var(--line)", color: "var(--dim)" }
            }
          >
            {r} days
          </a>
        ))}
      </nav>

      <section className="card flex gap-6 p-4">
        <div>
          <p className="dim text-[11px] font-medium uppercase tracking-wide">Core hours</p>
          <p className="text-3xl font-semibold tabular-nums">{Math.round(score.core * 100)}%</p>
        </div>
        <div>
          <p className="dim text-[11px] font-medium uppercase tracking-wide">Streak</p>
          <p className="text-3xl font-semibold tabular-nums">{score.currentStreak}</p>
          <p className="dim text-xs">best {score.bestStreak}</p>
        </div>
      </section>

      {rows.length === 0 ? (
        <p className="dim card p-4 text-sm">
          Nothing logged yet. Tick things off on Today and this fills in.
        </p>
      ) : (
        <>
          <Group title="The four hours" slots={core} />
          <Group title="Everything else" slots={rest} />
        </>
      )}
    </div>
  );
}

function Group({
  title,
  slots,
}: {
  title: string;
  slots: { key: string; label: string; scheduled: number; done: number; silent: number; rate: number }[];
}) {
  if (slots.length === 0) return null;

  return (
    <section>
      <h2 className="dim mb-2 text-[11px] font-medium uppercase tracking-wide">{title}</h2>
      <ul className="space-y-2">
        {slots.map((s) => (
          <li key={s.key} className="card p-3">
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium">{s.label}</span>
              <span className="dim text-xs tabular-nums">
                {s.done}/{s.scheduled}
                {s.silent > 0 && ` · ${s.silent} unanswered`}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.round(s.rate * 100)}%`, background: "var(--fg)" }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
