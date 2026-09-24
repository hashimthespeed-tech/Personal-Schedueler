"use client";

import { useEffect, useMemo, useState } from "react";
import type { CustomAllocation, CustomTradeoffDraft } from "@/core/schoolwork";
import "./custom-tradeoff-editor.css";

function dayLabel(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

export function CustomTradeoffEditor({ draft, busy, initiallyOpen = false, onApprove }: {
  draft: CustomTradeoffDraft;
  busy: boolean;
  initiallyOpen?: boolean;
  onApprove: (allocation: CustomAllocation[]) => void;
}) {
  const signature = draft.sources.map((source) => `${source.id}:${source.maxRemovable}`).join("|");
  const [open, setOpen] = useState(initiallyOpen);
  const [values, setValues] = useState<Record<string, number>>({});

  useEffect(() => {
    setValues({});
    setOpen(initiallyOpen);
  }, [signature, initiallyOpen]);

  const total = useMemo(() => Object.values(values).reduce((sum, value) => sum + value, 0), [values]);
  const remaining = draft.requiredMinutes - total;

  if (!open) {
    return <button type="button" className="custom-tradeoff-open" onClick={() => setOpen(true)}>
      Edit my own plan
      <span>Choose exactly where the {draft.requiredMinutes} minutes come from →</span>
    </button>;
  }

  return <section className="custom-tradeoff" aria-labelledby="custom-tradeoff-title">
    <div className="custom-tradeoff-heading">
      <div><p>YOUR CUSTOM PLAN</p><h3 id="custom-tradeoff-title">Choose the minutes</h3></div>
      <button type="button" onClick={() => setOpen(false)} aria-label="Close custom plan">×</button>
    </div>
    <p className="custom-tradeoff-help">Each item has its own limit. Adjusting one never changes or borrows from another.</p>
    <div className={`custom-tradeoff-meter ${remaining === 0 ? "ready" : remaining < 0 ? "over" : ""}`}>
      <strong>{Math.abs(remaining)} min</strong>
      <span>{remaining === 0 ? "Plan balanced" : remaining > 0 ? "still needed" : "too many removed"}</span>
    </div>
    <div className="custom-tradeoff-sources">
      {draft.sources.map((source) => {
        const value = values[source.id] ?? 0;
        return <label key={source.id} className="custom-tradeoff-source">
          <span className="custom-tradeoff-source-head"><span><strong>{source.title}</strong><small>{dayLabel(source.date)}</small></span><b>{value} min</b></span>
          <input type="range" min="0" max={source.maxRemovable} step="1" value={value}
            aria-label={`Minutes to take from ${source.title} on ${dayLabel(source.date)}`}
            onChange={(event) => setValues((old) => ({ ...old, [source.id]: Number(event.target.value) }))} />
          <span className="custom-tradeoff-limits">
            <span>Original <b>{source.originalMinutes}</b></span><span>Keep at least <b>{source.minimumMinutes}</b></span><span>Can take <b>{source.maxRemovable}</b></span>
          </span>
        </label>;
      })}
    </div>
    <button type="button" className="schoolwork-primary" disabled={busy || remaining !== 0}
      onClick={() => onApprove(draft.sources.map((source) => ({ sourceId: source.id, minutes: values[source.id] ?? 0 })))}>
      {busy ? "Saving…" : remaining === 0 ? "Approve my custom plan" : `Choose ${remaining > 0 ? remaining : Math.abs(remaining)} min ${remaining > 0 ? "more" : "less"}`}
    </button>
  </section>;
}
