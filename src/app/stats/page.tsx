import { gte } from "drizzle-orm";
import { db } from "@/db/index";
import { routineLog } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { checkSchema } from "@/lib/schema-guard";
import { SetupNeeded } from "@/components/SetupNeeded";
import { Grid, IntensityChart, SlotTable } from "@/components/Consistency";
import { consistency, windowEnding } from "@/core/consistency";
import { today } from "@/core/clock";

export const dynamic = "force-dynamic";

const RANGES = [
  { days: 7, label: "Week" },
  { days: 30, label: "Month" },
  { days: 90, label: "Quarter" },
] as const;

/**
 * Consistency.
 *
 * The one number a fixed routine owes you, and the only thing the old
 * solver-era stats page could never produce honestly: when blocks moved every
 * night, a gap might have been a miss or might have been a block that was never
 * placed. Same slots every day means done-over-scheduled means what it says.
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
  const range = RANGES.find((r) => String(r.days) === asked) ?? RANGES[1];

  const date = today();
  const window = windowEnding(date, range.days);
  const rows = await db.select().from(routineLog).where(gte(routineLog.onDate, window.from));

  const score = consistency(
    window.from,
    window.to,
    rows.map((r) => ({
      onDate: r.onDate,
      slotKey: r.slotKey,
      status: r.status as "done" | "missed",
      intensity: r.intensity,
    })),
  );

  const empty = rows.length === 0;

  return (
    <div className="space-y-6 pt-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Consistency</h1>
        <p className="dim text-sm">Same slots every day, so these numbers compare.</p>
      </header>

      <nav className="flex gap-1.5">
        {RANGES.map((r) => (
          <a
            key={r.days}
            href={`/stats?days=${r.days}`}
            className="rounded-full px-3.5 py-1.5 text-xs font-medium"
            style={
              r.days === range.days
                ? { background: "var(--fg)", color: "var(--bg)" }
                : { border: "1px solid var(--line)", color: "var(--dim)" }
            }
          >
            {r.label}
          </a>
        ))}
      </nav>

      {empty ? (
        <p className="dim card p-4 text-sm">
          Nothing logged yet. Tick things off on Today and this fills in — the charts need a few
          days before they say anything useful.
        </p>
      ) : (
        <>
          <section className="card grid grid-cols-2 gap-5 p-4 sm:grid-cols-4">
            <Tile label="Core hours" value={`${Math.round(score.core * 100)}%`} />
            <Tile label="Streak" value={String(score.currentStreak)} sub={`best ${score.bestStreak}`} />
            <Tile label="Days" value={String(score.days)} sub="since you started" />
            <Tile
              label="Intensity"
              value={score.avgIntensity === null ? "—" : score.avgIntensity.toFixed(1)}
              sub={score.avgIntensity === null ? "not rated yet" : "out of 10"}
            />
          </section>

          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold">Everything, day by day</h2>
            <Grid score={score} />
          </section>

          <section className="card p-4">
            <h2 className="mb-3 text-sm font-semibold">How hard you went</h2>
            <IntensityChart score={score} />
          </section>

          <section className="card p-4">
            <h2 className="mb-1 text-sm font-semibold">The numbers</h2>
            <p className="dim mb-3 text-xs">
              Skipped means you never answered — different from missing it, and not counted as one.
            </p>
            <SlotTable slots={score.slots} />
          </section>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="dim text-[11px] font-medium uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="dim text-[11px]">{sub}</p>}
    </div>
  );
}
