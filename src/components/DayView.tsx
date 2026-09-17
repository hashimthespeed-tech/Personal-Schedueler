"use client";

import { useCallback, useEffect, useState } from "react";
import { to12h } from "@/core/types";
import type { Day, Slot } from "@/core/routine";

interface SlotScore {
  key: string;
  label: string;
  scheduled: number;
  done: number;
  silent: number;
  rate: number;
}

interface Payload {
  day: Day;
  extraSchoolHour: boolean;
  marks: Record<string, "done" | "missed">;
  consistency: { core: number; currentStreak: number; slots: SlotScore[] };
}

const DAY_LABEL: Record<string, string> = {
  school: "School day",
  practice: "Practice day",
  weekend: "Weekend",
};

function dayName(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
  });
}

function dayDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "long",
  });
}

/** The collapsed detail: one whole sentence, never a word cut in half. */
function firstSentence(detail: string): string {
  const stop = detail.search(/[.!?]\s|[.!?]$/);
  if (stop === -1 || stop + 1 >= detail.length) return detail;
  return `${detail.slice(0, stop + 1)} …`;
}

function shift(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Today.
 *
 * The founding constraint of this whole project was that the daily loop has to
 * take under a minute or it dies. So this is one screen: the day as it is
 * always shaped, and a tick or a cross against the seven things that are
 * actually scored. Nothing here is generated, nothing moved overnight, and
 * there is nothing to read before you can act.
 */
export function DayView({ initialDate }: { initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async (on: string) => {
    const res = await fetch(`/api/day?date=${on}`);
    if (!res.ok) {
      setError("Could not load the day.");
      return;
    }
    setData((await res.json()) as Payload);
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  async function mark(slotKey: string, status: "done" | "missed" | null) {
    if (!data) return;
    setBusy(slotKey);
    setError("");

    // optimistic — the tick has to feel instant or the minute budget is gone
    setData((d) => {
      if (!d) return d;
      const marks = { ...d.marks };
      if (status === null) delete marks[slotKey];
      else marks[slotKey] = status;
      return { ...d, marks };
    });

    try {
      const res = await fetch("/api/day", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "mark", onDate: date, slotKey, status }),
      });
      if (!res.ok) {
        setError("That did not save.");
        await load(date);
      }
    } catch {
      setError("Network error — that did not save.");
      await load(date);
    } finally {
      setBusy(null);
    }
  }

  async function toggleExtraHour() {
    if (!data) return;
    setBusy("extra");
    await fetch("/api/day", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "adjust", onDate: date, extraSchoolHour: !data.extraSchoolHour }),
    });
    await load(date);
    setBusy(null);
  }

  if (!data) return <p className="dim card p-4 text-sm">Loading…</p>;

  const scored = data.day.slots.filter((s) => s.tracked);
  const doneCount = scored.filter((s) => data.marks[s.key] === "done").length;

  return (
    <div className="space-y-4 pb-4">
      <header className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{dayName(date)}</h1>
          <p className="dim text-sm">
            {dayDate(date)} · {DAY_LABEL[data.day.type]} · {doneCount}/{scored.length} done
            {data.consistency.currentStreak > 0 && ` · ${data.consistency.currentStreak}-day streak`}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            type="button"
            onClick={() => setDate(shift(date, -1))}
            aria-label="Previous day"
            className="card px-2.5 py-1.5 text-sm"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => setDate(initialDate)}
            className="card px-2.5 py-1.5 text-xs font-medium"
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => setDate(shift(date, 1))}
            aria-label="Next day"
            className="card px-2.5 py-1.5 text-sm"
          >
            ›
          </button>
        </div>
      </header>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <ol className="space-y-1.5">
        {data.day.slots.map((slot) => (
          <SlotRow
            key={slot.key + slot.start}
            slot={slot}
            status={data.marks[slot.key]}
            busy={busy === slot.key}
            onMark={mark}
          />
        ))}
      </ol>

      <button
        type="button"
        onClick={toggleExtraHour}
        disabled={busy === "extra"}
        className="card w-full p-3 text-left text-sm disabled:opacity-50"
      >
        <span className="font-medium">
          {data.extraSchoolHour ? "Second school hour is on" : "Need more school time today?"}
        </span>
        <span className="dim mt-0.5 block text-xs">
          {data.extraSchoolHour
            ? "Tap to drop it back to one hour."
            : "Adds a second hour after Business & AI. Just for today."}
        </span>
      </button>
    </div>
  );
}

function SlotRow({
  slot,
  status,
  busy,
  onMark,
}: {
  slot: Slot;
  status: "done" | "missed" | undefined;
  busy: boolean;
  onMark: (key: string, status: "done" | "missed" | null) => void;
}) {
  const [open, setOpen] = useState(false);

  if (slot.kind === "anchor") {
    return (
      <li className="flex items-baseline gap-3 px-1 pt-2 text-xs">
        <span className="dim w-16 shrink-0 tabular-nums">{to12h(slot.start)}</span>
        <span className="dim font-medium uppercase tracking-wide">{slot.label}</span>
      </li>
    );
  }

  const accent = slot.domain ? `var(--color-${slot.domain})` : "var(--line)";
  const isCore = slot.kind === "core";

  return (
    <li
      className="card overflow-hidden border-l-2"
      style={{
        borderLeftColor: slot.tracked ? accent : "var(--line)",
        opacity: status === "missed" ? 0.55 : 1,
        background: slot.kind === "free" ? "transparent" : undefined,
      }}
    >
      <div className="flex items-start gap-3 p-3">
        <span className="dim w-16 shrink-0 pt-0.5 text-xs tabular-nums">{to12h(slot.start)}</span>

        <div className="min-w-0 flex-1">
          <p
            className={isCore ? "text-sm font-semibold" : "dim text-sm"}
            style={status === "done" ? { textDecoration: "line-through" } : undefined}
          >
            {slot.label}
            {slot.end > slot.start && (
              <span className="dim ml-2 text-xs font-normal">
                {slot.end - slot.start} min
              </span>
            )}
          </p>
          {slot.detail && (
            <button
              type="button"
              onClick={() => setOpen(!open)}
              className="dim mt-0.5 text-left text-xs"
            >
              {open ? slot.detail : firstSentence(slot.detail)}
            </button>
          )}
        </div>

        {slot.tracked && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => onMark(slot.key, status === "done" ? null : "done")}
              aria-label={`${slot.label} done`}
              className="rounded-lg px-2.5 py-1 text-sm disabled:opacity-40"
              style={
                status === "done"
                  ? { background: accent, color: "#fff" }
                  : { border: "1px solid var(--line)" }
              }
            >
              ✓
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onMark(slot.key, status === "missed" ? null : "missed")}
              aria-label={`${slot.label} missed`}
              className="dim rounded-lg px-2.5 py-1 text-sm disabled:opacity-40"
              style={
                status === "missed"
                  ? { background: "var(--color-physique)", color: "#fff" }
                  : { border: "1px solid var(--line)" }
              }
            >
              ✕
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
