"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TimelineItem } from "@/core/timeline";

function to12h(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  const h24 = Math.floor(m / 60);
  const mm = m % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${suffix}`;
}

export interface TimelineState {
  /** block id -> done or skipped */
  blocks: Record<string, boolean | null>;
  /** prayer block -> status */
  prayers: Record<string, string | null>;
  /** steps and notes for expandable blocks */
  detail: Record<string, { notes: string | null; steps: string[] | null }>;
}

/**
 * The day, in order.
 *
 * Three kinds of row, drawn differently on purpose. A day made entirely of
 * identical tickable boxes makes waking up look like an achievement and a
 * lesson look optional, so anchors are quiet, fixed things are outlined, and
 * only real work carries its domain colour.
 */
export function Timeline({
  date,
  items,
  state,
  nowMin,
}: {
  date: string;
  items: TimelineItem[];
  state: TimelineState;
  nowMin: number;
}) {
  const router = useRouter();
  const [blocks, setBlocks] = useState(state.blocks);
  const [prayers, setPrayers] = useState(state.prayers);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function toggleBlock(id: string, skipped: boolean) {
    setBusy(id);
    const current = blocks[id];
    const undo = skipped ? current === false : current === true;
    await fetch("/api/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blockId: Number(id), skipped, done: !undo }),
    });
    setBlocks((b) => ({ ...b, [id]: undo ? null : !skipped }));
    setBusy(null);
    router.refresh();
  }

  /**
   * Marking a prayer prayed or missed.
   *
   * Missed is its own answer, not the absence of one. Blank means "not yet";
   * a red cross means it did not happen, and only that is honest enough to
   * count against him. Tapping the same answer twice clears it.
   */
  async function setPrayer(block: string, answer: "done" | "missed", start: number) {
    setBusy(block);
    const current = prayers[block];
    const wanted =
      answer === "missed" ? "missed" : nowMin - start > 60 ? "late" : "on-time";
    const isSame = answer === "missed" ? current === "missed" : current === "on-time" || current === "late";
    const next = isSame ? null : wanted;

    await fetch("/api/prayer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ onDate: date, block, status: next }),
    });
    setPrayers((p) => ({ ...p, [block]: next }));
    setBusy(null);
    router.refresh();
  }

  return (
    <ol className="space-y-1.5">
      {items.map((item) => {
        const past = (item.end ?? item.start) <= nowMin;
        const next = !past && item.start > nowMin;

        if (item.kind === "anchor") {
          return (
            <li key={item.id} className="flex items-baseline gap-3 px-1 py-1.5">
              <span className="dim w-20 shrink-0 text-xs tabular-nums">{to12h(item.start)}</span>
              <span className="dim text-xs font-medium uppercase tracking-wide">{item.label}</span>
            </li>
          );
        }

        if (item.kind === "fixed") {
          const isPrayer = Boolean(item.ref && item.ref.match(/fajr|dhuhr-asr|maghrib-isha/));
          const status = isPrayer ? prayers[item.ref ?? ""] : null;
          const prayed = status === "on-time" || status === "late";
          const missed = status === "missed";

          return (
            <li key={item.id}>
              <div
                className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{
                  border: missed
                    ? "1px dashed var(--color-physique)"
                    : "1px dashed var(--line)",
                  opacity: past && !status ? 0.55 : 1,
                }}
              >
                <span className="dim w-20 shrink-0 text-xs tabular-nums">{to12h(item.start)}</span>
                <span className="flex-1 truncate text-sm">
                  <span style={prayed ? { textDecoration: "line-through" } : undefined}>
                    {item.label}
                  </span>
                  {status === "late" && <span className="dim text-xs"> · late</span>}
                  {missed && <span className="dim text-xs"> · missed</span>}
                </span>
                {isPrayer && (
                  <span className="flex shrink-0 gap-1.5">
                    <button
                      type="button"
                      disabled={busy === item.ref}
                      onClick={() => setPrayer(item.ref ?? "", "done", item.start)}
                      aria-label={`${item.label} prayed`}
                      className="rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
                      style={
                        prayed
                          ? { background: "var(--color-deen)", color: "#fff" }
                          : { border: "1px solid var(--line)", color: "var(--dim)" }
                      }
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      disabled={busy === item.ref}
                      onClick={() => setPrayer(item.ref ?? "", "missed", item.start)}
                      aria-label={`${item.label} missed`}
                      className="rounded-lg px-2.5 py-1 text-xs font-semibold disabled:opacity-40"
                      style={
                        missed
                          ? { background: "var(--color-physique)", color: "#fff" }
                          : { border: "1px solid var(--line)", color: "var(--dim)" }
                      }
                    >
                      ✕
                    </button>
                  </span>
                )}
              </div>
            </li>
          );
        }

        const done = blocks[item.ref ?? ""];
        const detail = state.detail[item.ref ?? ""];
        const hasDetail = (detail?.steps?.length ?? 0) > 0 || Boolean(detail?.notes);
        const expanded = open === item.id;

        return (
          <li
            key={item.id}
            className={`card d-${item.domain ?? "school"} border-l-4`}
            style={done === false || (past && done == null) ? { opacity: 0.5 } : undefined}
          >
            <button
              type="button"
              onClick={() => hasDetail && setOpen(expanded ? null : item.id)}
              className="flex w-full items-center gap-3 p-3 text-left"
              style={{ cursor: hasDetail ? "pointer" : "default" }}
            >
              <span className="dim w-20 shrink-0 text-xs tabular-nums">{to12h(item.start)}</span>
              <span className="flex-1 text-sm font-medium">
                <span style={done === true ? { textDecoration: "line-through" } : undefined}>
                  {item.label}
                </span>
                {hasDetail && <span className="dim ml-1.5 text-xs">{expanded ? "▾" : "▸"}</span>}
              </span>
              {next && <span className="dim shrink-0 text-[11px]">next</span>}
            </button>

            {expanded && detail && (
              <div className="px-3 pb-3 pl-[7.25rem]">
                {detail.notes && <p className="dim mb-2 text-xs leading-relaxed">{detail.notes}</p>}
                {detail.steps && (
                  <ol className="space-y-1">
                    {detail.steps.map((step, i) => (
                      <li key={i} className="flex gap-2 text-xs leading-relaxed">
                        <span className="dim tabular-nums">{i + 1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            <div className="flex gap-2 border-t px-3 py-2" style={{ borderColor: "var(--line)" }}>
              <button
                type="button"
                disabled={busy === item.ref}
                onClick={() => toggleBlock(item.ref ?? "", false)}
                className="flex-1 rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
                style={
                  done === true
                    ? { background: "var(--fg)", color: "var(--bg)" }
                    : { border: "1px solid var(--line)" }
                }
              >
                {done === true ? "Done" : "Mark done"}
              </button>
              <button
                type="button"
                disabled={busy === item.ref}
                onClick={() => toggleBlock(item.ref ?? "", true)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40"
                style={
                  done === false
                    ? { background: "var(--fg)", color: "var(--bg)" }
                    : { border: "1px solid var(--line)" }
                }
              >
                Skip
              </button>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
