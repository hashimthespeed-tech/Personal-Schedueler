"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export interface BlockData {
  id: number;
  title: string;
  domain: string;
  startMin: number;
  endMin: number;
  notes: string | null;
  steps: string[] | null;
  chunkIndex: number | null;
  chunkCount: number | null;
  completed: boolean | null;
}

function to12h(minute: number): string {
  const h24 = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * A scheduled block. The detail — exercises, the parts of an assignment — is
 * behind a tap, so a training session reads as one line rather than six.
 */
export function BlockCard({ block, past }: { block: BlockData; past: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<boolean | null>(block.completed);

  const hasDetail = (block.steps?.length ?? 0) > 0 || Boolean(block.notes);

  async function mark(skipped: boolean) {
    setBusy(true);
    const undo = skipped ? state === false : state === true;
    await fetch("/api/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ blockId: block.id, skipped, done: !undo }),
    });
    setState(undo ? null : !skipped);
    setBusy(false);
    router.refresh();
  }

  const dim = state === false || (past && state === null);

  return (
    <li className={`card d-${block.domain} border-l-4`} style={dim ? { opacity: 0.5 } : undefined}>
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className="flex w-full items-baseline justify-between gap-3 p-3 text-left"
        style={{ cursor: hasDetail ? "pointer" : "default" }}
      >
        <span className="text-sm font-medium">
          <span style={state === true ? { textDecoration: "line-through" } : undefined}>
            {block.title}
          </span>
          {hasDetail && <span className="dim ml-1.5 text-xs">{open ? "▾" : "▸"}</span>}
        </span>
        <span className="dim shrink-0 text-xs tabular-nums">
          {to12h(block.startMin)}–{to12h(block.endMin)}
        </span>
      </button>

      {block.chunkCount && block.chunkCount > 1 && (
        <p className="dim -mt-1 px-3 pb-1 text-xs">
          part {block.chunkIndex} of {block.chunkCount}
        </p>
      )}

      {open && hasDetail && (
        <div className="px-3 pb-3">
          {block.notes && <p className="dim mb-2 text-xs leading-relaxed">{block.notes}</p>}
          {block.steps && block.steps.length > 0 && (
            <ol className="space-y-1">
              {block.steps.map((step, i) => (
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
          disabled={busy}
          onClick={() => mark(false)}
          className="flex-1 rounded-lg py-1.5 text-xs font-medium disabled:opacity-40"
          style={
            state === true
              ? { background: "var(--fg)", color: "var(--bg)" }
              : { border: "1px solid var(--line)" }
          }
        >
          {state === true ? "Done" : "Mark done"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => mark(true)}
          className="rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-40"
          style={
            state === false
              ? { background: "var(--fg)", color: "var(--bg)" }
              : { border: "1px solid var(--line)" }
          }
        >
          Skip
        </button>
      </div>
    </li>
  );
}
