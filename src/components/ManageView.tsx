"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { domainLabel } from "@/lib/domains";

interface TaskRow {
  id: string;
  title: string;
  domain: string;
  agent: string;
  durationMin: number;
  recurrence: string;
  dayPart: string | null;
  hasSteps: boolean;
}

interface Summary {
  tasks: number;
  blocks: number;
  threads: number;
  openNeeds: number;
  byDomain: Record<string, number>;
  byAgent: Record<string, number>;
  list: TaskRow[];
}

const AGENTS = ["coach", "tutor", "ustadh", "builder"];

export function ManageView() {
  const router = useRouter();
  const [data, setData] = useState<Summary | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/reset");
    if (res.ok) setData((await res.json()) as Summary);
  }

  useEffect(() => {
    void load();
  }, []);

  async function run(payload: Record<string, unknown>, key: string, needsConfirm = false) {
    if (needsConfirm && confirming !== key) {
      setConfirming(key);
      setMessage("");
      return;
    }
    setBusy(true);
    setConfirming(null);
    const res = await fetch("/api/reset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const out = (await res.json()) as { ok: boolean; cleared?: string; error?: string };
    setMessage(out.ok ? (out.cleared ?? "Done.") : (out.error ?? "Failed."));
    setBusy(false);
    await load();
    router.refresh();
  }

  if (!data) return <p className="dim card p-4 text-sm">Loading…</p>;

  const Btn = ({
    label, onClick, danger, confirmKey,
  }: { label: string; onClick: () => void; danger?: boolean; confirmKey?: string }) => {
    const isConfirming = confirmKey !== undefined && confirming === confirmKey;
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onClick}
        className="rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40"
        style={
          isConfirming
            ? { background: "var(--color-physique)", color: "#fff" }
            : danger
              ? { border: "1px solid var(--color-physique)", color: "var(--color-physique)" }
              : { border: "1px solid var(--line)" }
        }
      >
        {isConfirming ? "Tap again to confirm" : label}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {message && (
        <p className="card p-3 text-sm" style={{ borderColor: "var(--fg)" }}>
          {message}
        </p>
      )}

      <Link href="/debug" className="card flex items-center justify-between gap-3 p-4">
        <span className="min-w-0">
          <span className="block text-sm font-medium">Show me what you got →</span>
          <span className="dim block text-xs">
            Everything the scheduler knows, with a Copy button. Paste it into a chat when you
            want help reading the plan.
          </span>
        </span>
      </Link>

      <section className="card p-4">
        <p className="mb-1 text-sm font-medium">Right now</p>
        <p className="dim text-xs">
          {data.tasks} tasks · {data.blocks} scheduled blocks · {data.threads} chat messages
          {data.openNeeds > 0 && ` · ${data.openNeeds} open question${data.openNeeds === 1 ? "" : "s"}`}
        </p>
      </section>

      <section className="card p-4">
        <p className="text-sm font-medium">Clear the schedule only</p>
        <p className="dim mt-0.5 mb-3 text-xs">
          Removes the placements and re-solves from the same tasks. Use when the timing is
          wrong but the work is right.
        </p>
        <Btn label="Clear and re-solve" onClick={() => run({ scope: "schedule" }, "schedule")} />
      </section>

      <section className="card p-4">
        <p className="text-sm font-medium">Delete by agent</p>
        <p className="dim mt-0.5 mb-3 text-xs">Everything one specialist created.</p>
        <div className="flex flex-wrap gap-2">
          {AGENTS.map((a) => (
            <Btn
              key={a}
              danger
              confirmKey={`agent-${a}`}
              label={`${a} (${data.byAgent[a] ?? 0})`}
              onClick={() => run({ scope: "agent", agent: a }, `agent-${a}`, true)}
            />
          ))}
        </div>
      </section>

      <section className="card p-4">
        <p className="text-sm font-medium">Delete by area</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {Object.entries(data.byDomain).map(([d, n]) => (
            <Btn
              key={d}
              danger
              confirmKey={`domain-${d}`}
              label={`${domainLabel(d)} (${n})`}
              onClick={() => run({ scope: "domain", domain: d }, `domain-${d}`, true)}
            />
          ))}
          {Object.keys(data.byDomain).length === 0 && <p className="dim text-xs">No tasks.</p>}
        </div>
      </section>

      <section className="card p-4">
        <p className="text-sm font-medium">Start over</p>
        <p className="dim mt-0.5 mb-3 text-xs">
          Deletes every task, the schedule, the weekly plan and every conversation. Your completion history
          and your goals stay.
        </p>
        <div className="flex flex-wrap gap-2">
          <Btn
            danger
            confirmKey="tasks"
            label={`Delete all ${data.tasks} tasks`}
            onClick={() => run({ scope: "tasks" }, "tasks", true)}
          />
          <Btn
            danger
            confirmKey="everything"
            label="Delete everything"
            onClick={() => run({ scope: "everything" }, "everything", true)}
          />
        </div>
      </section>

      {data.list.length > 0 && (
        <section>
          <p className="mb-2 text-sm font-semibold">Every task ({data.list.length})</p>
          <ul className="space-y-1.5">
            {data.list.map((t) => (
              <li key={t.id} className={`card d-${t.domain} flex items-center gap-2 border-l-4 p-2.5`}>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{t.title}</p>
                  <p className="dim text-[11px]">
                    {t.agent} · {t.durationMin}min · {t.dayPart ?? "anytime"}
                    {t.recurrence !== "once" && ` · ${t.recurrence}`}
                    {!t.hasSteps && " · no detail"}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run({ scope: "task", taskId: t.id }, `task-${t.id}`)}
                  className="shrink-0 rounded px-2 py-1 text-[11px] font-medium disabled:opacity-40"
                  style={{ border: "1px solid var(--line)", color: "var(--color-physique)" }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
