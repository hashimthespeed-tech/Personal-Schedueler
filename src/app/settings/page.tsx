import { db } from "@/db/index";
import { settings } from "@/db/schema";
import { requireSession } from "@/lib/auth";
import { PushSetup } from "@/components/PushSetup";
import { to12h } from "@/core/types";
import { dayFor } from "@/core/routine";
import { today } from "@/core/clock";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  await requireSession();

  const row = (await db.select().from(settings).limit(1))[0];
  // one source of truth for bedtime: the routine, the same one Today shows
  const day = dayFor(today());

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
              <Row label="Wake" value={to12h(day.wake)} />
              <Row label="Lights out" value={to12h(day.lightsOut)} />
              <Row label="Target" value={`${(row.targetSleepMin / 60).toFixed(0)}h`} />
              <p className="dim mt-2 text-xs leading-relaxed">
                One wake — Fajr is still inside its window at 6:00, so nothing comes off the
                night. That holds until 2 May, when sunrise beats the alarm and the last weeks
                of school need an earlier one.
              </p>
            </section>

            <section className="card p-4">
              <p className="mb-2 text-sm font-medium">The day</p>
              <Row label="Core hours" value="4 — Islam, school, training, build" />
              <Row label="Practice" value="Tuesday and Thursday" />
              <Row label="Lifting" value="Mon, Wed, Fri, Sat" />
              <p className="dim mt-2 text-xs leading-relaxed">
                The routine is the same shape every week. Nothing reshuffles it overnight — if a
                day needs to change, change it on Today and it stays changed for that day only.
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
