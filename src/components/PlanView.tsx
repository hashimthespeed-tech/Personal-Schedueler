"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { to12h } from "@/core/types";

interface Need {
  id: number;
  agent: string;
  gemKey: string | null;
  question: string;
  why: string;
  urgency: number;
}

interface PlannedBlock {
  id: number;
  title: string;
  domain: string;
  onDate: string;
  startMin: number;
  endMin: number;
  steps: string[] | null;
}

interface Proposal {
  id: number;
  weekStart: string;
  status: string;
  summary: string;
  reports: Record<string, string> | null;
  notFitting: string[] | null;
}

interface Payload {
  weekStart: string;
  proposal: Proposal | null;
  needs: Need[];
  blocks: PlannedBlock[];
}

const LABEL: Record<string, string> = {
  coach: "Coach",
  tutor: "Tutor",
  ustadh: "Ustadh",
  builder: "Builder",
};

function weekLabel(iso: string): string {
  const start = new Date(`${iso}T12:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (d: Date, withMonth: boolean) =>
    d.toLocaleDateString("en-US", withMonth ? { day: "numeric", month: "short" } : { day: "numeric" });
  const sameMonth = start.getMonth() === end.getMonth();
  return `${fmt(start, !sameMonth)}–${fmt(end, true)}`;
}

function dayName(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

export function PlanView() {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/plan");
    if (!res.ok) return setError("Could not load the plan.");
    setData((await res.json()) as Payload);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(payload: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.headers.get("content-type")?.includes("application/json")) {
        setError(res.status === 504 ? "That took too long and timed out." : `Server error (${res.status}).`);
        return;
      }
      const body = (await res.json()) as { ok: boolean; error?: string };
      if (!body.ok) setError(body.error ?? "Failed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="dim card p-4 text-sm">Loading…</p>;

  const byDay = new Map<string, PlannedBlock[]>();
  for (const b of data.blocks) byDay.set(b.onDate, [...(byDay.get(b.onDate) ?? []), b]);

  const proposal = data.proposal;
  const decided = proposal?.status === "approved" || proposal?.status === "rejected";

  return (
    <div className="space-y-5 pb-4">
      <section className="card p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{weekLabel(proposal?.weekStart ?? data.weekStart)}</h2>
            <p className="dim mt-1 text-sm leading-relaxed">
              {proposal?.summary ?? "No plan yet. Ask everyone what the week needs."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => post({ action: "plan" })}
            disabled={busy}
            className="shrink-0 rounded-xl px-3.5 py-2 text-sm font-medium disabled:opacity-40"
            style={{ background: "var(--fg)", color: "var(--bg)" }}
          >
            {busy ? "Asking…" : proposal ? "Re-plan" : "Plan the week"}
          </button>
        </div>

        {busy && (
          <p className="dim mt-3 text-xs">
            Asking the coach, tutor, ustadh and builder in turn. A minute or two.
          </p>
        )}

        {proposal && !decided && (
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => post({ action: "decide", id: proposal.id, status: "approved" })}
              disabled={busy}
              className="rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ border: "1px solid var(--line)" }}
            >
              Looks right
            </button>
            <button
              type="button"
              onClick={() => post({ action: "decide", id: proposal.id, status: "rejected" })}
              disabled={busy}
              className="dim rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ border: "1px solid var(--line)" }}
            >
              Not this
            </button>
          </div>
        )}

        {proposal && decided && (
          <p className="dim mt-3 text-xs">
            {proposal.status === "approved"
              ? "Approved. It is already the schedule."
              : "You sent this back. Tell the gem what is wrong, then re-plan."}
          </p>
        )}

        <p className="dim mt-3 text-xs leading-relaxed">
          This is already on your calendar either way — a plan that needs permission to exist
          stops existing the first busy Sunday. Approving just means you have looked at it.
        </p>
      </section>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {data.needs.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Nobody could plan around these</h2>
          <p className="dim mt-1 text-sm leading-relaxed">
            Each one is a question an agent could not answer for itself. Answering them in the hub
            is the single highest-value thing on this page — until then they are all guessing.
          </p>
          <ul className="mt-3 space-y-2">
            {data.needs.map((need) => (
              <li
                key={need.id}
                className="rounded-xl p-3"
                style={{ background: "var(--bg)", border: "1px solid var(--line)" }}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: need.urgency === 1 ? "var(--color-physique)" : "var(--dim)" }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{need.question}</p>
                    <p className="dim mt-0.5 text-xs">
                      {LABEL[need.agent] ?? need.agent} · {need.why}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  <Link
                    href="/hub"
                    className="rounded-lg px-2.5 py-1 text-xs font-medium"
                    style={{ border: "1px solid var(--line)" }}
                  >
                    Answer in the hub →
                  </Link>
                  <button
                    type="button"
                    onClick={() => post({ action: "resolve", id: need.id })}
                    disabled={busy}
                    className="dim rounded-lg px-2.5 py-1 text-xs"
                    style={{ border: "1px solid var(--line)" }}
                  >
                    Answered
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {proposal?.reports && Object.keys(proposal.reports).length > 0 && (
        <section className="card p-4">
          <h2 className="mb-2 text-sm font-semibold">What each one said</h2>
          <ul className="space-y-3">
            {Object.entries(proposal.reports).map(([agent, note]) => (
              <li key={agent}>
                <p className="text-xs font-semibold">{LABEL[agent] ?? agent}</p>
                <p className="dim mt-0.5 text-sm leading-relaxed whitespace-pre-wrap">{note}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {proposal?.notFitting && proposal.notFitting.length > 0 && (
        <section className="card p-4">
          <h2 className="text-sm font-semibold">Did not fit</h2>
          <ul className="mt-2 space-y-1">
            {proposal.notFitting.map((line, i) => (
              <li key={i} className="dim text-sm">
                {line}
              </li>
            ))}
          </ul>
        </section>
      )}

      {byDay.size > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold">The week</h2>
          <div className="space-y-4">
            {[...byDay.entries()].map(([date, items]) => (
              <div key={date}>
                <p className="dim mb-1.5 text-xs font-medium">{dayName(date)}</p>
                <ul className="space-y-1">
                  {items.map((b) => (
                    <li
                      key={b.id}
                      className="card flex items-baseline gap-3 border-l-2 px-3 py-2"
                      style={{ borderLeftColor: `var(--color-${b.domain})` }}
                    >
                      <span className="dim shrink-0 text-xs tabular-nums">
                        {to12h(b.startMin)}–{to12h(b.endMin)}
                      </span>
                      <span className="min-w-0 flex-1 text-sm">{b.title}</span>
                      {b.steps && b.steps.length > 0 && (
                        <span className="dim shrink-0 text-[11px]">
                          {b.steps.length} step{b.steps.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
