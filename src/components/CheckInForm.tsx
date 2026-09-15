"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface BlockSummary {
  id: number;
  title: string;
  domain: string;
}

/**
 * The whole system depends on this taking under a minute. Four inputs, all
 * tap-or-drag, nothing typed unless he wants to. Anything derivable is not
 * asked for.
 */
export function CheckInForm({
  date,
  blocks,
  alreadyDone,
}: {
  date: string;
  blocks: BlockSummary[];
  alreadyDone: boolean;
}) {
  const router = useRouter();
  const [sleepHours, setSleepHours] = useState(7);
  const [energy, setEnergy] = useState(3);
  const [slipped, setSlipped] = useState<number[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  function toggle(id: number) {
    setSlipped((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function submit() {
    setBusy(true);
    await fetch("/api/checkin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        date,
        sleepMin: Math.round(sleepHours * 60),
        energy,
        slippedBlockIds: slipped,
        note: note.trim() || null,
      }),
    });
    setBusy(false);
    setDone(true);
    router.refresh();
  }

  if (done || alreadyDone) {
    return (
      <div className="card p-5 text-center">
        <p className="text-sm font-medium">Logged for today.</p>
        <p className="dim mt-1 text-xs">Tomorrow's plan gets rebuilt tonight.</p>
        {alreadyDone && !done && (
          <button
            type="button"
            className="mt-3 text-xs font-medium underline"
            onClick={() => {
              setDone(false);
              router.refresh();
            }}
          >
            Log again
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="flex items-baseline justify-between">
          <label htmlFor="sleep" className="text-sm font-medium">Sleep</label>
          <span className="text-sm font-semibold tabular-nums">{sleepHours.toFixed(1)}h</span>
        </div>
        <input
          id="sleep"
          type="range"
          min={3}
          max={11}
          step={0.5}
          value={sleepHours}
          onChange={(e) => setSleepHours(Number(e.target.value))}
          className="mt-3 w-full"
        />
        <p className="dim mt-1 text-xs">Not counting the Fajr wake.</p>
      </section>

      <section className="card p-4">
        <p className="mb-3 text-sm font-medium">Energy</p>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setEnergy(n)}
              className="flex-1 rounded-lg py-3 text-sm font-medium"
              style={
                energy === n
                  ? { background: "var(--fg)", color: "var(--bg)" }
                  : { background: "transparent", border: "1px solid var(--line)" }
              }
            >
              {n}
            </button>
          ))}
        </div>
      </section>

      <section className="card p-4">
        <p className="text-sm font-medium">What slipped?</p>
        <p className="dim mt-0.5 mb-3 text-xs">Tap anything that didn't happen. No judgement — it tunes the plan.</p>
        {blocks.length === 0 ? (
          <p className="dim text-xs">Nothing was scheduled today.</p>
        ) : (
          <ul className="space-y-1.5">
            {blocks.map((b) => {
              const on = slipped.includes(b.id);
              return (
                <li key={b.id}>
                  <button
                    type="button"
                    onClick={() => toggle(b.id)}
                    className={`d-${b.domain} w-full rounded-lg border-l-4 px-3 py-2 text-left text-sm`}
                    style={
                      on
                        ? { background: "var(--fg)", color: "var(--bg)" }
                        : { border: "1px solid var(--line)", borderLeftWidth: "4px" }
                    }
                  >
                    {b.title}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card p-4">
        <label htmlFor="note" className="text-sm font-medium">Anything else</label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Optional"
          className="mt-2 w-full resize-none bg-transparent text-sm outline-none"
          style={{ color: "var(--fg)" }}
        />
      </section>

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="w-full rounded-xl px-4 py-3.5 text-base font-medium disabled:opacity-40"
        style={{ background: "var(--fg)", color: "var(--bg)" }}
      >
        {busy ? "Saving…" : "Done"}
      </button>
    </div>
  );
}
