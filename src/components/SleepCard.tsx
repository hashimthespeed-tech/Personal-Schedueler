"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

function to12h(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

/**
 * Last night, reported this morning.
 *
 * Asking at bedtime asks him to predict when he will fall asleep. Asking the
 * next morning asks him to remember, which is the only one of the two anybody
 * can actually answer. So this lives on Today, not in the nightly check-in.
 *
 * Bedtime runs past midnight, so the slider goes above 1440 and wraps on the
 * way out — 1500 is 1:00 AM, and the arithmetic stays monotonic while the user
 * is dragging.
 */
export function SleepCard({
  date,
  bedtimeMin,
  wakeMin,
  targetSleepMin = 480,
}: {
  date: string;
  bedtimeMin?: number | null;
  wakeMin?: number | null;
  targetSleepMin?: number;
}) {
  const router = useRouter();
  const [bed, setBed] = useState(
    bedtimeMin == null ? 1320 : bedtimeMin < 720 ? bedtimeMin + 1440 : bedtimeMin,
  );
  const [wake, setWake] = useState(wakeMin ?? 360);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(bedtimeMin != null);

  // one wake: at 6:00 Fajr is still inside its window (until 2 May), so there
  // is nothing to deduct and the span is the sleep
  const net = (wake + 1440 - (bed % 1440)) % 1440;
  const vsTarget = net - targetSleepMin;

  async function save() {
    setBusy(true);
    await fetch("/api/sleep", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ onDate: date, bedtimeMin: bed % 1440, wakeMin: wake }),
    });
    setBusy(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <section className="card p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <p className="text-sm font-medium">Last night</p>
        <p className="text-sm font-semibold tabular-nums">
          {(net / 60).toFixed(1)}h
          <span className="dim font-normal">
            {" "}
            {vsTarget >= 0 ? "on target" : `${(Math.abs(vsTarget) / 60).toFixed(1)}h short`}
          </span>
        </p>
      </div>

      <label htmlFor="bed" className="flex items-baseline justify-between text-xs">
        <span className="dim">Went to bed</span>
        <span className="font-medium tabular-nums">{to12h(bed)}</span>
      </label>
      <input
        id="bed"
        type="range"
        min={1200}
        max={1620}
        step={15}
        value={bed}
        onChange={(e) => {
          setBed(Number(e.target.value));
          setSaved(false);
        }}
        className="mb-3 mt-1 w-full"
      />

      <label htmlFor="wake" className="flex items-baseline justify-between text-xs">
        <span className="dim">Got up</span>
        <span className="font-medium tabular-nums">{to12h(wake)}</span>
      </label>
      <input
        id="wake"
        type="range"
        min={240}
        max={720}
        step={15}
        value={wake}
        onChange={(e) => {
          setWake(Number(e.target.value));
          setSaved(false);
        }}
        className="mt-1 w-full"
      />

      <p className="dim mt-2 text-xs leading-relaxed">
        {"Fajr is inside its window at 6:00 — one wake, nothing deducted."}
      </p>

      <button
        type="button"
        onClick={save}
        disabled={busy || saved}
        className="mt-3 w-full rounded-lg py-2 text-xs font-medium disabled:opacity-40"
        style={{ background: "var(--fg)", color: "var(--bg)" }}
      >
        {busy ? "Saving…" : saved ? "Logged" : "Log it"}
      </button>
    </section>
  );
}
