import { db } from "@/db/index";
import { settings } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { PushSetup } from "@/components/PushSetup";
import { to12h } from "@/core/types";
import { sleepNightFor } from "@/core/sleep";
import { today } from "@/agents/context";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireSession();

  const row = (await db.select().from(settings).limit(1))[0];
  const night = sleepNightFor(today());

  return (
    <div className="pt-6">
      <h1 className="mb-5 text-2xl font-semibold tracking-tight">Settings</h1>

      <div className="space-y-4">
        <PushSetup />

        {row && (
          <>
            <section className="card p-4">
              <p className="mb-2 text-sm font-medium">Prayer</p>
              <Row label="Location" value={`${row.latitude.toFixed(3)}, ${row.longitude.toFixed(3)}`} />
              <Row label="Method" value="Jafari (16° / 14° / 4°)" />
              <Row label="Combining" value="Dhuhr+Asr, Maghrib+Isha" />
              <p className="dim mt-2 text-xs leading-relaxed">
                Maghrib is computed 4° past sunset, not at sunset — roughly 15 minutes later.
              </p>
            </section>

            <section className="card p-4">
              <p className="mb-2 text-sm font-medium">Sleep</p>
              <Row label="Wake" value={to12h(row.dayStartMin)} />
              <Row label="Bedtime tonight" value={to12h(night.bedtime)} />
              <Row label="Goal bedtime" value={to12h(row.goalBedtimeMin)} />
              <Row label="Ramp" value={`${row.rampMinutesPerWeek} min/week`} />
              <Row label="Fajr interruption" value={`${row.fajrInterruptionMin} min`} />
            </section>

            <section className="card p-4">
              <p className="mb-2 text-sm font-medium">Training</p>
              <Row label="Phase" value={row.wrestlingPhase} />
              <Row label="Restrictions" value={(row.restrictions ?? []).join(", ") || "none"} />
              <Row label="Calories" value={`${row.calorieTarget ?? "—"} kcal`} />
              <Row label="Protein" value={`${row.proteinTargetG ?? "—"} g`} />
            </section>

            <section className="card p-4">
              <p className="mb-2 text-sm font-medium">Scheduling</p>
              <Row label="Max utilization" value={`${Math.round(row.maxUtilization * 100)}%`} />
              <p className="dim mt-2 text-xs leading-relaxed">
                The solver never books more than this share of free time.
              </p>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-0.5 text-sm">
      <span className="dim">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
