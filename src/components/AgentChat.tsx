"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

export function AgentChat({ agent, initial }: { agent: string; initial: Turn[] }) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actions, setActions] = useState<string[]>([]);
  const [error, setError] = useState("");

  async function send() {
    const message = draft.trim();
    if (!message || busy) return;

    setTurns((t) => [...t, { role: "user", content: message }]);
    setDraft("");
    setBusy(true);
    setActions([]);
    setError("");

    try {
      const res = await fetch(`/api/agent/${agent}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message }),
      });

      // A gateway timeout or platform error returns an HTML page, not JSON.
      // Parsing it blindly turns a clear "this took too long" into an opaque
      // "Unexpected token 'A' is not valid JSON".
      if (!res.headers.get("content-type")?.includes("application/json")) {
        setError(
          res.status === 504
            ? "That took too long and timed out. Any tasks it created before timing out were still saved — check the Week tab. Try a shorter request."
            : `The server returned an error (${res.status}). Try again in a moment.`,
        );
        return;
      }

      const data = (await res.json()) as {
        ok: boolean;
        text?: string;
        actions?: string[];
        replanned?: boolean;
        error?: string;
      };

      if (!data.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        setTurns((t) => [...t, { role: "assistant", content: data.text ?? "" }]);
        setActions(data.actions ?? []);
        if (data.replanned) router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-4 space-y-3">
        {turns.length === 0 && (
          <p className="dim card p-4 text-sm">
            Nothing here yet. Tell them what's going on.
          </p>
        )}
        {turns.map((turn, i) => (
          <div
            key={i}
            className={turn.role === "user" ? "ml-8" : "mr-4"}
          >
            <div
              className="rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
              style={
                turn.role === "user"
                  ? { background: "var(--fg)", color: "var(--bg)" }
                  : { background: "var(--card)", border: "1px solid var(--line)" }
              }
            >
              {turn.content}
            </div>
          </div>
        ))}
        {busy && <p className="dim px-2 text-sm">Thinking…</p>}
      </div>

      {actions.length > 0 && (
        <div className="card mb-4 p-3">
          <p className="dim text-[11px] font-medium uppercase tracking-wide">Changed</p>
          <ul className="mt-1 space-y-0.5">
            {actions.map((a, i) => (
              <li key={i} className="text-xs">{a}</li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mb-3 text-sm text-red-500">{error}</p>}

      <div className="flex gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Say something…"
          className="card flex-1 resize-none px-3 py-2.5 text-sm outline-none"
          style={{ color: "var(--fg)" }}
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || draft.trim().length === 0}
          className="shrink-0 self-end rounded-xl px-4 py-2.5 text-sm font-medium disabled:opacity-40"
          style={{ background: "var(--fg)", color: "var(--bg)" }}
        >
          Send
        </button>
      </div>
    </div>
  );
}
