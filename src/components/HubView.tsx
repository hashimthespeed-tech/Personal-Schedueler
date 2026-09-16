"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { downscale, readAsBase64 } from "@/lib/downscale";
import { Reply } from "./Reply";
import {
  ACCEPTED,
  MAX_FILES,
  MAX_PDF_BYTES,
  MAX_TOTAL_BASE64,
  describeSize,
  isImage,
} from "@/lib/attachments";

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

interface StoredFile {
  id: number;
  name: string;
  mediaType: string;
  bytes: number;
}

interface Message {
  id: number;
  role: string;
  content: string;
  actions: string[] | null;
  files: StoredFile[];
}

interface Loaded {
  conversation: { id: number; title: string; gemId: number };
  gem: { id: number; label: string; blurb: string | null; domain: string; memory: string | null } | null;
  messages: Message[];
}

interface Draft {
  key: string;
  name: string;
  mediaType: string;
  data: string;
  bytes: number;
  preview: string | null;
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
 *
 * This is the one page that takes the whole window. It is a workspace rather
 * than something to read, and it is desktop-only by design: the phone captures,
 * the laptop converses.
 */
/** The panel toggle, drawn rather than typed — "⟨" renders as a stray paren. */
function PanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
      <line x1="6" y1="2.5" x2="6" y2="13.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

export function HubView() {
  const [gems, setGems] = useState<Gem[] | null>(null);
  const [openGem, setOpenGem] = useState<number | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sidebar, setSidebar] = useState(true);
  const [dragging, setDragging] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const previews = useRef<string[]>([]);

  const loadGems = useCallback(async () => {
    const res = await fetch("/api/gems");
    const data = (await res.json()) as { gems?: Gem[] };
    setGems(data.gems ?? []);
  }, []);

  useEffect(() => {
    void loadGems();
    setSidebar(window.matchMedia("(min-width: 1024px)").matches);
    return () => previews.current.forEach((url) => URL.revokeObjectURL(url));
  }, [loadGems]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [loaded?.messages.length, busy]);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = "0px";
    box.style.height = `${Math.min(box.scrollHeight, 220)}px`;
  }, [draft, loaded?.conversation.id]);

  function clearDraft() {
    setDraft("");
    setFiles([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function openConversation(id: number) {
    setError("");
    clearDraft();
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
      boxRef.current?.focus();
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

  /**
   * Take files from the picker, a paste, or a drop.
   *
   * Photographs are shrunk here rather than server-side: the cap that matters
   * is the request body, so a four-megabyte camera frame has to come down
   * before it is sent, not after it arrives.
   */
  async function addFiles(incoming: FileList | File[]) {
    setError("");
    const chosen: Draft[] = [];

    for (const file of Array.from(incoming)) {
      if (files.length + chosen.length >= MAX_FILES) {
        setError(`${MAX_FILES} files at a time.`);
        break;
      }
      if (!ACCEPTED.includes(file.type)) {
        setError(`${file.name} is a ${file.type || "kind of file"} — images and PDFs only.`);
        continue;
      }
      if (!isImage(file.type) && file.size > MAX_PDF_BYTES) {
        setError(`${file.name} is ${describeSize(file.size)}. PDFs have to be under 2.5 MB.`);
        continue;
      }

      try {
        const isPicture = isImage(file.type);
        const data = isPicture ? (await downscale(file)).base64 : await readAsBase64(file);
        const preview = isPicture ? URL.createObjectURL(file) : null;
        if (preview) previews.current.push(preview);

        chosen.push({
          key: `${file.name}-${Date.now()}-${chosen.length}`,
          name: file.name,
          mediaType: isPicture ? "image/jpeg" : file.type,
          data,
          bytes: Math.round((data.length * 3) / 4),
          preview,
        });
      } catch {
        setError(`Could not read ${file.name}.`);
      }
    }

    const next = [...files, ...chosen];
    if (next.reduce((total, f) => total + f.data.length, 0) > MAX_TOTAL_BASE64) {
      setError("That is more than fits in one message. Send them a couple at a time.");
      return;
    }
    setFiles(next);
  }

  function dropFile(key: string) {
    setFiles((current) => current.filter((f) => f.key !== key));
  }

  async function send() {
    const message = draft.trim();
    if ((!message && files.length === 0) || !loaded || busy) return;

    const sending = files;
    const optimistic: Message = {
      id: -1,
      role: "user",
      content: message,
      actions: null,
      files: sending.map((f, i) => ({ id: -1 - i, name: f.name, mediaType: f.mediaType, bytes: f.bytes })),
    };

    clearDraft();
    setBusy(true);
    setError("");
    setLoaded((l) => (l ? { ...l, messages: [...l.messages, optimistic] } : l));

    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId: loaded.conversation.id,
          message,
          files: sending.map((f) => ({ name: f.name, mediaType: f.mediaType, data: f.data })),
        }),
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

  const composer = (
    <div
      className="rounded-3xl px-3 py-2.5"
      style={{ background: "var(--card)", border: "1px solid var(--line)" }}
    >
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2">
          {files.map((f) => (
            <li
              key={f.key}
              className="group relative flex items-center gap-2 rounded-xl py-1.5 pl-1.5 pr-7 text-xs"
              style={{ background: "var(--bg)", border: "1px solid var(--line)" }}
            >
              {f.preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.preview} alt="" className="h-9 w-9 rounded-lg object-cover" />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-lg text-[10px] font-semibold"
                      style={{ background: "var(--card)" }}>
                  PDF
                </span>
              )}
              <span className="max-w-[9rem] truncate">{f.name}</span>
              <span className="dim">{describeSize(f.bytes)}</span>
              <button
                type="button"
                onClick={() => dropFile(f.key)}
                aria-label={`Remove ${f.name}`}
                className="dim absolute right-1.5 top-1.5 text-xs"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label="Attach a photo or PDF"
          title="Attach a photo or PDF"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-lg leading-none"
          style={{ border: "1px solid var(--line)" }}
        >
          +
        </button>

        <textarea
          ref={boxRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onPaste={(e) => {
            const pasted = Array.from(e.clipboardData.files);
            if (pasted.length > 0) {
              e.preventDefault();
              void addFiles(pasted);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder={loaded?.gem ? `Message ${loaded.gem.label}…` : "Message…"}
          className="max-h-[220px] flex-1 resize-none bg-transparent py-2 text-sm leading-relaxed outline-none"
          style={{ color: "var(--fg)" }}
        />

        <button
          type="button"
          onClick={send}
          disabled={busy || (draft.trim().length === 0 && files.length === 0)}
          className="h-9 shrink-0 rounded-full px-4 text-sm font-medium disabled:opacity-35"
          style={{ background: "var(--fg)", color: "var(--bg)" }}
        >
          Send
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPTED.join(",")}
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
        }}
      />
    </div>
  );

  const categories = gems ? [...new Set(gems.map((g) => g.category))] : [];

  return (
    <div
      className="flex overflow-hidden"
      style={{ height: "calc(100dvh - var(--nav-h) - env(safe-area-inset-top, 0px))" }}
      onDragOver={(e) => {
        e.preventDefault();
        if (loaded) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (loaded && e.dataTransfer.files.length > 0) void addFiles(e.dataTransfer.files);
      }}
    >
      {sidebar && (
        <aside
          className="flex w-[264px] shrink-0 flex-col overflow-y-auto border-r px-2 py-3"
          style={{ borderColor: "var(--line)", background: "var(--card)" }}
        >
          <div className="mb-3 flex items-center justify-between px-2">
            <span className="text-sm font-semibold tracking-tight">Hub</span>
            <button
              type="button"
              onClick={() => setSidebar(false)}
              aria-label="Close sidebar"
              title="Close sidebar"
              className="dim rounded p-1"
            >
              <PanelIcon />
            </button>
          </div>

          {!gems && <p className="dim px-2 text-sm">Loading…</p>}

          {categories.map((category) => (
            <section key={category} className="mb-3">
              <p className="dim mb-1 px-2 text-[11px] font-medium uppercase tracking-wide">{category}</p>
              <ul className="space-y-0.5">
                {gems!
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
                          style={active ? { background: "var(--bg)", fontWeight: 600 } : undefined}
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: `var(--color-${gem.domain})` }}
                          />
                          <span className="flex-1 truncate">{gem.label}</span>
                          {gem.hasMemory && <span className="dim text-[10px]" title="Remembers things">•</span>}
                          <span className="dim text-[10px]">{expanded ? "▾" : "▸"}</span>
                        </button>

                        {expanded && (
                          <div
                            className="ml-4 mt-0.5 space-y-0.5 border-l pl-2"
                            style={{ borderColor: "var(--line)" }}
                          >
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
                                      ? { background: "var(--bg)", fontWeight: 600 }
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
      )}

      <div className="relative flex min-w-0 flex-1 flex-col">
        {dragging && (
          <div
            className="pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-2xl text-sm font-medium"
            style={{ border: "2px dashed var(--line)", background: "color-mix(in srgb, var(--bg) 85%, transparent)" }}
          >
            Drop a photo or PDF
          </div>
        )}

        <header
          className="flex shrink-0 items-center gap-3 border-b px-4 py-3"
          style={{ borderColor: "var(--line)" }}
        >
          {!sidebar && (
            <button
              type="button"
              onClick={() => setSidebar(true)}
              aria-label="Open sidebar"
              title="Open sidebar"
              className="dim rounded p-1"
            >
              <PanelIcon />
            </button>
          )}
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{loaded?.gem?.label ?? "Hub"}</h1>
            <p className="dim truncate text-xs">
              {loaded?.gem?.blurb ?? "The full conversation. Your phone handles capture."}
            </p>
          </div>
        </header>

        {!loaded ? (
          <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-6 py-8">
            <h2 className="mb-2 text-center text-3xl font-semibold tracking-tight">
              What are we working on?
            </h2>
            <p className="dim mb-7 max-w-lg text-center text-sm leading-relaxed">
              Each one keeps its own chats and its own memory — your calculus tutor remembers what
              you get stuck on in calculus, and does not carry four other subjects into every
              question.
            </p>

            <div className="grid w-full max-w-2xl grid-cols-2 gap-2 sm:grid-cols-3">
              {(gems ?? []).map((gem) => (
                <button
                  key={gem.id}
                  type="button"
                  onClick={() => {
                    setOpenGem(gem.id);
                    void newChat(gem.id);
                  }}
                  className="card flex items-start gap-2 p-3 text-left"
                >
                  <span
                    className="mt-1 h-2 w-2 shrink-0 rounded-full"
                    style={{ background: `var(--color-${gem.domain})` }}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium">{gem.label}</span>
                    <span className="dim block truncate text-[11px]">{gem.blurb}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4">
              <div className="mx-auto w-full max-w-3xl py-6">
                {loaded.gem?.memory && (
                  <details className="card mb-5 p-3">
                    <summary className="cursor-pointer text-xs font-medium">What it remembers</summary>
                    <pre className="dim mt-2 whitespace-pre-wrap text-xs leading-relaxed">
                      {loaded.gem.memory}
                    </pre>
                  </details>
                )}

                {loaded.messages.length === 0 && (
                  <p className="dim text-sm">New chat. Say what you need, or attach a photo.</p>
                )}

                <div className="space-y-5">
                  {loaded.messages.map((m) => (
                    <div key={m.id} className={m.role === "user" ? "flex flex-col items-end" : ""}>
                      {m.files.length > 0 && (
                        <ul className={`mb-1.5 flex flex-wrap gap-2 ${m.role === "user" ? "justify-end" : ""}`}>
                          {m.files.map((f) =>
                            isImage(f.mediaType) && f.id > 0 ? (
                              <li key={f.id}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={`/api/attachments?id=${f.id}`}
                                  alt={f.name}
                                  className="max-h-60 rounded-xl"
                                  style={{ border: "1px solid var(--line)" }}
                                />
                              </li>
                            ) : (
                              <li
                                key={f.id}
                                className="card flex items-center gap-2 px-3 py-2 text-xs"
                              >
                                <span className="font-semibold">
                                  {isImage(f.mediaType) ? "IMG" : "PDF"}
                                </span>
                                <span className="max-w-[12rem] truncate">{f.name}</span>
                              </li>
                            ),
                          )}
                        </ul>
                      )}

                      {m.content &&
                        (m.role === "user" ? (
                          <div
                            className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
                            style={{ background: "var(--card)", border: "1px solid var(--line)" }}
                          >
                            {m.content}
                          </div>
                        ) : (
                          <Reply content={m.content} />
                        ))}

                      {m.actions && m.actions.length > 0 && (
                        <ul className="dim mt-1.5 space-y-0.5 text-xs">
                          {m.actions.map((a, i) => (
                            <li key={i}>· {a}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ))}
                  {busy && <p className="dim text-sm">Thinking…</p>}
                  <div ref={endRef} />
                </div>
              </div>
            </div>

            <div className="shrink-0 px-4 pb-4">
              <div className="mx-auto w-full max-w-3xl">
                {error && <p className="mb-2 text-sm text-red-500">{error}</p>}
                {composer}
                <p className="dim mt-1.5 text-center text-[11px]">
                  Enter sends · Shift+Enter for a new line · paste or drop a photo
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
