"use client";

import { useState } from "react";

/**
 * Inline SVG charts. No library: the mark specs here are specific enough
 * (4px rounded data-ends anchored to the baseline, 2px lines, a 2px surface
 * gap between adjacent fills) that fighting a chart library's defaults costs
 * more than drawing them.
 */

/** A single headline number. Not a chart, and should not be drawn as one. */
export function StatTile({
  label, value, sub,
}: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <p className="dim text-[11px] font-medium uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-3xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="dim mt-0.5 text-xs">{sub}</p>}
    </div>
  );
}

export interface BarRow {
  key: string;
  label: string;
  value: number;
  /** shown on the bar, e.g. "4/6" */
  display: string;
  color: string;
}

/**
 * Horizontal bars for comparing magnitude across a handful of named things.
 * Every bar is directly labelled, so identity never rests on colour alone.
 */
export function BarChart({ rows, max = 1 }: { rows: BarRow[]; max?: number }) {
  return (
    <div className="card p-4">
      <ul className="space-y-3">
        {rows.map((r) => {
          const pct = max === 0 ? 0 : Math.max(0, Math.min(1, r.value / max)) * 100;
          return (
            <li key={r.key}>
              <div className="mb-1 flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium">{r.label}</span>
                <span className="dim text-xs tabular-nums">{r.display}</span>
              </div>
              <div
                className="h-2 w-full overflow-hidden rounded-full"
                style={{ background: "var(--line)" }}
                role="img"
                aria-label={`${r.label}: ${r.display}`}
              >
                <div
                  className="h-full rounded-full"
                  style={{ width: `${pct}%`, background: r.color, minWidth: pct > 0 ? "4px" : "0" }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export interface DayPoint {
  date: string;
  done: number;
  skipped: number;
}

/** Completions per day. Hover gives the exact counts for a day. */
export function DailyBars({ data }: { data: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.done + d.skipped));
  const active = hover === null ? null : data[hover];

  return (
    <div className="card p-4">
      <div className="flex h-24 items-end gap-[2px]">
        {data.map((d, i) => {
          const total = d.done + d.skipped;
          const h = (total / max) * 100;
          const doneShare = total === 0 ? 0 : (d.done / total) * 100;
          return (
            <button
              key={d.date}
              type="button"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="relative flex-1"
              style={{ height: "100%" }}
              aria-label={`${d.date}: ${d.done} done, ${d.skipped} skipped`}
            >
              <span
                className="absolute bottom-0 left-0 right-0 overflow-hidden rounded-t"
                style={{
                  height: `${h}%`,
                  background: "var(--line)",
                  opacity: hover === null || hover === i ? 1 : 0.55,
                }}
              >
                <span
                  className="absolute bottom-0 left-0 right-0 rounded-t"
                  style={{ height: `${doneShare}%`, background: "var(--fg)" }}
                />
              </span>
            </button>
          );
        })}
      </div>
      <p className="dim mt-2 h-4 text-xs tabular-nums">
        {active
          ? `${active.date} — ${active.done} done${active.skipped ? `, ${active.skipped} skipped` : ""}`
          : `${data.length} days`}
      </p>
    </div>
  );
}

export interface LinePoint {
  date: string;
  value: number | null;
}

/** A single measure over time. One series, so the title names it — no legend. */
export function LineChart({
  data, min, max, suffix = "", decimals = 0,
}: {
  data: LinePoint[];
  min: number;
  max: number;
  /** a descriptor rather than a formatter — a server page cannot pass a function */
  suffix?: string;
  decimals?: number;
}) {
  const format = (v: number) => `${v.toFixed(decimals)}${suffix}`;
  const [hover, setHover] = useState<number | null>(null);
  const W = 300;
  const H = 80;
  const span = Math.max(1, max - min);

  const pts = data.map((d, i) => ({
    ...d,
    x: data.length === 1 ? W / 2 : (i / (data.length - 1)) * W,
    y: d.value === null ? null : H - ((d.value - min) / span) * H,
  }));

  const drawn = pts.filter((p) => p.y !== null);
  const path = drawn.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${(p.y ?? 0).toFixed(1)}`).join(" ");
  const active = hover === null ? null : pts[hover];

  if (drawn.length === 0) {
    return <p className="dim card p-4 text-xs">Nothing logged yet.</p>;
  }

  return (
    <div className="card p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full overflow-visible" role="img">
        <path d={path} fill="none" stroke="var(--fg)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {drawn.map((p) => (
          <circle
            key={p.date}
            cx={p.x}
            cy={p.y ?? 0}
            r={hover !== null && pts[hover]?.date === p.date ? 5 : 3}
            fill="var(--fg)"
            stroke="var(--card)"
            strokeWidth={2}
          />
        ))}
        {pts.map((p, i) => (
          <rect
            key={`hit-${p.date}`}
            x={p.x - W / Math.max(1, data.length) / 2}
            y={-8}
            width={W / Math.max(1, data.length)}
            height={H + 16}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>
      <p className="dim mt-2 h-4 text-xs tabular-nums">
        {active && active.value !== null
          ? `${active.date} — ${format(active.value)}`
          : `${format(min)} to ${format(max)}`}
      </p>
    </div>
  );
}
