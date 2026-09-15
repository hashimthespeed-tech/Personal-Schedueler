"use client";

import Link from "next/link";

const RANGES = [7, 30, 90];

export function StatsRange({ current }: { current: number }) {
  return (
    <div className="flex gap-1">
      {RANGES.map((days) => (
        <Link
          key={days}
          href={`/stats?days=${days}`}
          className="rounded-full px-2.5 py-1 text-xs font-medium"
          style={
            days === current
              ? { background: "var(--fg)", color: "var(--bg)" }
              : { border: "1px solid var(--line)", color: "var(--dim)" }
          }
        >
          {days}d
        </Link>
      ))}
    </div>
  );
}
