"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Kind = "homework" | "schedule" | "note";

const KINDS: { value: Kind; label: string; agent: string }[] = [
  { value: "homework", label: "Homework", agent: "tutor" },
  { value: "schedule", label: "Schedule", agent: "tutor" },
  { value: "note", label: "Note", agent: "tutor" },
];

/** Long edge, in pixels. Full-resolution phone photos are far larger than the
 *  model needs and make the upload slow on school wifi. */
const MAX_EDGE = 1400;
const JPEG_QUALITY = 0.82;

async function downscale(file: File): Promise<{ base64: string; mediaType: "image/jpeg" }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that image.");
  ctx.drawImage(bitmap, 0, 0, w, h);

  const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  return { base64: dataUrl.split(",")[1] ?? "", mediaType: "image/jpeg" };
}

export function CaptureForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<Kind>("homework");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ summary: string; created: string[] } | null>(null);
  const [error, setError] = useState("");

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setResult(null);
    setError("");
    const reader = new FileReader();
    reader.onload = () => setPreview(String(reader.result));
    reader.readAsDataURL(f);
  }

  async function send() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const { base64, mediaType } = await downscale(file);
      const agent = KINDS.find((k) => k.value === kind)?.agent ?? "tutor";
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, image: base64, mediaType, note, kind }),
      });

      if (!res.headers.get("content-type")?.includes("application/json")) {
        setError(
          res.status === 504
            ? "That took too long. Try a clearer photo of just the assignment."
            : `Server error (${res.status}).`,
        );
        return;
      }

      const data = (await res.json()) as {
        ok: boolean;
        summary?: string;
        created?: string[];
        error?: string;
      };

      if (!data.ok) {
        setError(data.error ?? "Failed.");
      } else {
        setResult({ summary: data.summary ?? "", created: data.created ?? [] });
        setFile(null);
        setPreview(null);
        setNote("");
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {result && (
        <section className="card p-4">
          <p className="text-sm leading-relaxed">{result.summary}</p>
          {result.created.length > 0 && (
            <>
              <p className="dim mt-3 text-[11px] font-medium uppercase tracking-wide">Added</p>
              <ul className="mt-1 space-y-0.5">
                {result.created.map((c, i) => (
                  <li key={i} className="text-xs">{c}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      <section className="card p-4">
        <p className="mb-3 text-sm font-medium">What is it?</p>
        <div className="flex gap-2">
          {KINDS.map((k) => (
            <button
              key={k.value}
              type="button"
              onClick={() => setKind(k.value)}
              className="flex-1 rounded-lg py-2 text-xs font-medium"
              style={
                kind === k.value
                  ? { background: "var(--fg)", color: "var(--bg)" }
                  : { border: "1px solid var(--line)" }
              }
            >
              {k.label}
            </button>
          ))}
        </div>
      </section>

      <section className="card p-4">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="What you photographed" className="mb-3 w-full rounded-lg" />
        ) : (
          <p className="dim mb-3 text-xs">
            Get the whole sheet in frame and make sure the due date is readable.
          </p>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={pick}
          className="block w-full text-xs"
        />
      </section>

      <section className="card p-4">
        <label htmlFor="note" className="text-sm font-medium">Anything to add</label>
        <textarea
          id="note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Optional — e.g. only the odd problems"
          className="mt-2 w-full resize-none bg-transparent text-sm outline-none"
          style={{ color: "var(--fg)" }}
        />
      </section>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="button"
        onClick={send}
        disabled={busy || !file}
        className="w-full rounded-xl px-4 py-3.5 text-base font-medium disabled:opacity-40"
        style={{ background: "var(--fg)", color: "var(--bg)" }}
      >
        {busy ? "Reading it…" : "Send"}
      </button>
    </div>
  );
}
