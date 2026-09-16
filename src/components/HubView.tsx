"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ConversationSummary {
  id: number;
  title: string;
  updatedAt: string;
}

interface Gem {
  id: number;
  key: string;
  label: string;
  blurb: string | null;
  category: string;
  domain: string;
  hasMemory: boolean;
  conversations: ConversationSummary[];
}

interface Message {
  id: number;
  role: string;
  content: string;
  actions: string[] | null;
}

interface Loaded {
  conversation: { id: number; title: string; gemId: number };
  gem: { id: number; label: string; blurb: string | null; domain: string; memory: string | null } | null;
  messages: Message[];
}

/**
 * The hub.
 *
 * A gem per subject rather than one tutor across five: a single thread for all
 * of school means every calculus question arrives with four other courses of
 * history attached, and nothing accumulates into knowing how he does calculus.
 *
 * Conversations live under a gem, and only the gem's memory crosses between
 * them — so a new chat starts clean without starting ignorant.
 */
export function HubView() {
  const [gems, setGems] = useState<Gem[] | null>(null);
  const [openGem, setOpenGem] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const loadGems = useCallback(async () => {
    const res = await fetch("/api/gems");
    const data = (await res.json()) as { gems?: Gem[] };
    setGems(data.gems ?? []);
    return data.gems ?? [];
  }, []);

  useEffect(() => {
    void loadGems();
  }, [loadGems]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [loaded?.messages.length, busy]);

  async function openConversation(id: number) {
    setError("");
    setDraft("");
    const res = await fetch(`/api/conversations?id=${id}`);
    if (!res.ok) {
      setError("Could not open that conversation.");
      return;
    }
    setLoaded((await res.json()) as Loaded);
  }

  async function newChat(gemId: number) {
    setError("");
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ gemId }),
    });
    const data = (await res.json()) as { conversationId?: number };
    if (data.conversationId) {
      await loadGems();
      await openConversation(data.conversationId);
    }
  }

  async function removeChat(id: number) {
    await fetch("/api/conversations", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: id }),
    });
    if (loaded?.conversation.id === id) setLoaded(null);
    await loadGems();
  }

  async function send() {
    const message = draft.trim();
    if (!message || !loaded || busy) return;

    setDraft("");
    setBusy(true);
    setError("");
    // optimistic, so the thread does not sit empty while Opus thinks
    setLoaded((l) =>
      l ? { ...l, messages: [...l.messages, { id: -1, role: "user", content: message, actions: null }] } : l,
    );

    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: loaded.conversation.id, message }),
      });

      if (!res.headers.get("content-type")?.includes("application/json")) {
        setError(res.status === 504 ? "That took too long and timed out." : `Server error (${res.status}).`);
        return;
      }

      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) setError(data.error ?? "Failed.");

      await openConversation(loaded.conversation.id);
      await loadGems();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  if (!gems) return <p className="dim card p-4 text-sm">Loading…</p>;

  const categories = [...new Set(gems.map((g) => g.category))];

  return (
    <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
      <aside className="space-y-4">
        {categories.map((category) => (
          <section key={category}>
            <p className="dim mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wide">
              {category}
            </p>
            <ul className="space-y-0.5">
              {gems
                .filter((g) => g.category === category)
                .map((gem) => {
                  const expanded = openGem === gem.id;
                  const active = loaded?.gem?.id === gem.id;
                  return (
                    <li key={gem.id}>
                      <button
                        type="button"
                        onClick={() => setOpenGem(expanded ? null : gem.id)}
                        className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]"
                        style={active ? { background: "var(--card)", fontWeight: 600 } : undefined}
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ background: `var(--color-${gem.domain})` }}
                        />
                        <span className="flex-1 truncate">{gem.label}</span>
                        {gem.hasMemory && <span className="dim text-[10px]">•</span>}
                        <span className="dim text-[10px]">{expanded ? "▾" : "▸"}</span>
                      </button>

                      {expanded && (
                        <div className="ml-4 mt-0.5 space-y-0.5 border-l pl-2" style={{ borderColor: "var(--line)" }}>
                          <button
                            type="button"
                            onClick={() => newChat(gem.id)}
                            className="w-full rounded px-2 py-1 text-left text-xs font-medium"
                          >
                            + New chat
                          </button>
                          {gem.conversations.map((c) => (
                            <div key={c.id} className="group flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openConversation(c.id)}
                                className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-xs"
                                style={
                                  loaded?.conversation.id === c.id
                                    ? { background: "var(--card)", fontWeight: 600 }
                                    : { color: "var(--dim)" }
                                }
                              >
                                {c.title}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeChat(c.id)}
                                aria-label={`Delete ${c.title}`}
                                className="dim shrink-0 px-1 text-xs opacity-0 group-hover:opacity-100"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                          {gem.conversations.length === 0 && (
                            <p className="dim px-2 py-1 text-xs">No chats yet.</p>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}
      </aside>

      <div className="min-w-0">
        {!loaded ? (
          <div className="card p-6">
            <p className="text-sm font-medium">Pick a gem on the left</p>
            <p className="dim mt-1 text-sm leading-relaxed">
              Each one keeps its own conversations and its own memory. Your calculus tutor
              remembers what you get stuck on in calculus, and does not carry four other
              subjects into every question.
            </p>
          </div>
        ) : (
          <>
            <header className="mb-4">
              <h2 className="text-lg font-semibold">{loaded.gem?.label}</h2>
              <p className="dim text-sm">{loaded.gem?.blurb}</p>
            </header>

            {loaded.gem?.memory && (
              <details className="card mb-4 p-3">
                <summary className="cursor-pointer text-xs font-medium">What it remembers</summary>
                <pre className="dim mt-2 whitespace-pre-wrap text-xs leading-relaxed">
                  {loaded.gem.memory}
                </pre>
              </details>
            )}

            <div className="mb-4 space-y-3">
              {loaded.messages.length === 0 && (
                <p className="dim card p-4 text-sm">New chat. Say what you need.</p>
              )}
              {loaded.messages.map((m) => (
                <div key={m.id} className={m.role === "user" ? "ml-12" : "mr-6"}>
                  <div
                    className="rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
                    style={
                      m.role === "user"
                        ? { background: "var(--fg)", color: "var(--bg)" }
                        : { background: "var(--card)", border: "1px solid var(--line)" }
                    }
                  >
                    {m.content}
                  </div>
                  {m.actions && m.actions.length > 0 && (
                    <ul className="dim mt-1 space-y-0.5 px-2 text-xs">
                      {m.actions.map((a, i) => (
                        <li key={i}>· {a}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
              {busy && <p className="dim px-2 text-sm">Thinking…</p>}
              <div ref={endRef} />
            </div>

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
                placeholder={`Message ${loaded.gem?.label ?? ""}…`}
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
          </>
        )}
      </div>
    </div>
  );
}
