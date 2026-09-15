"use client";

import { useEffect, useState } from "react";

export function DebugView() {
  const [text, setText] = useState("Loading…");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/debug")
      .then((r) => r.text())
      .then(setText)
      .catch((e) => setText(`Failed to load: ${e instanceof Error ? e.message : e}`));
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard is blocked in some contexts; selecting the text still works
      setCopied(false);
    }
  }

  return (
    <div>
      <div className="mb-3 flex gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-lg px-4 py-2 text-sm font-medium"
          style={{ background: "var(--fg)", color: "var(--bg)" }}
        >
          {copied ? "Copied" : "Copy all"}
        </button>
        <a
          href="/api/debug"
          target="_blank"
          rel="noreferrer"
          className="card px-4 py-2 text-sm font-medium"
        >
          Open raw
        </a>
      </div>

      <pre
        className="card overflow-x-auto p-3 text-[11px] leading-relaxed"
        style={{ whiteSpace: "pre", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}
      >
        {text}
      </pre>
    </div>
  );
}
