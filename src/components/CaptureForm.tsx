"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { CaptureCategory, CaptureTarget } from "@/data/capture-targets";

/**
 * Long edge in pixels. A full-resolution phone photo is far larger than the
 * model needs and makes the upload slow on school wifi.
 */
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

  return { base64: canvas.toDataURL("image/jpeg", JPEG_QUALITY).split(",")[1] ?? "", mediaType: "image/jpeg" };
}

export function CaptureForm() {
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  const [categories, setCategories] = useState<CaptureCategory[] | null>(null);
  const [category, setCategory] = useState<CaptureCategory | null>(null);
  const [target, setTarget] = useState<CaptureTarget | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ summary: string; created: string[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/capture")
      .then((r) => r.json())
      .then((d: { categories?: CaptureCategory[] }) => setCategories(d.categories ?? []))
      .catch(() => setError("Could not load the categories."));
  }, []);

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

  function reset() {
    setFile(null);
    setPreview(null);
    setNote("");
    if (cameraRef.current) cameraRef.current.value = "";
    if (libraryRef.current) libraryRef.current.value = "";
  }

  function back() {
    reset();
    setError("");
    setResult(null);
    if (target) setTarget(null);
    else setCategory(null);
  }

  async function send() {
    if (!file || !target) return;
    setBusy(true);
    setError("");
    try {
      const { base64, mediaType } = await downscale(file);
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId: target.id, image: base64, mediaType, note }),
      });

      if (!res.headers.get("content-type")?.includes("application/json")) {
        setError(
          res.status === 504
            ? "That took too long. Try a tighter photo of just the sheet."
            : `Server error (${res.status}).`,
        );
        return;
      }

      const data = (await res.json()) as {
        ok: boolean; summary?: string; created?: string[]; error?: string;
      };

      if (!data.ok) {
        setError(data.error ?? "Failed.");
      } else {
        setResult({ summary: data.summary ?? "", created: data.created ?? [] });
        reset();
        router.refresh();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!categories) return <p className="dim card p-4 text-sm">Loading…</p>;

  // Step 1 — which part of life
  if (!category) {
    return (
      <div className="space-y-4">
        {result && <ResultCard result={result} />}
        <div className="grid grid-cols-2 gap-3">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c)}
              className={`card d-${c.domain} border-l-4 p-4 text-left`}
            >
              <p className="text-sm font-semibold">{c.label}</p>
              <p className="dim mt-0.5 text-xs">{c.targets.length} options</p>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 2 — which subject, meal, or thing
  if (!target) {
    return (
      <div className="space-y-4">
        <BackBar label={category.label} onBack={back} />
        <ul className="space-y-2">
          {category.targets.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setTarget(t)}
                className={`card d-${t.domain} flex w-full items-center justify-between gap-3 border-l-4 p-3 text-left`}
              >
                <span>
                  <span className="block text-sm font-medium">{t.label}</span>
                  {t.hint && <span className="dim block text-xs">{t.hint}</span>}
                </span>
                <span className="dim text-xs">›</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // Step 3 — take the photo
  return (
    <div className="space-y-4">
      <BackBar label={`${category.label} · ${target.label}`} onBack={back} />

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={pick} hidden />
      <input ref={libraryRef} type="file" accept="image/*" onChange={pick} hidden />

      {preview ? (
        <div className="card overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="What you photographed" className="w-full" />
          <button
            type="button"
            onClick={reset}
            className="w-full border-t py-2.5 text-xs font-medium"
            style={{ borderColor: "var(--line)" }}
          >
            Retake
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 rounded-xl py-5 text-base font-semibold"
            style={{ background: "var(--fg)", color: "var(--bg)" }}
          >
            <CameraIcon />
            Take photo
          </button>
          <button
            type="button"
            onClick={() => libraryRef.current?.click()}
            className="card w-full py-3 text-sm font-medium"
          >
            Choose from library
          </button>
          <p className="dim px-1 pt-1 text-xs leading-relaxed">{advice(target)}</p>
        </div>
      )}

      {preview && (
        <>
          <section className="card p-4">
            <label htmlFor="note" className="text-sm font-medium">Anything to add</label>
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Optional"
              className="mt-2 w-full resize-none bg-transparent text-sm outline-none"
              style={{ color: "var(--fg)" }}
            />
          </section>

          <button
            type="button"
            onClick={send}
            disabled={busy}
            className="w-full rounded-xl px-4 py-3.5 text-base font-medium disabled:opacity-40"
            style={{ background: "var(--fg)", color: "var(--bg)" }}
          >
            {busy ? "Reading it…" : "Send"}
          </button>
        </>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
      {result && <ResultCard result={result} />}
    </div>
  );
}

function advice(target: CaptureTarget): string {
  switch (target.kind) {
    case "homework":
      return "Get the whole sheet in frame, and make sure the due date is readable.";
    case "syllabus":
      return "Every dated row needs to be legible — that is the part that matters.";
    case "meal":
      return "Shoot the plate from above so the portions are clear.";
    case "bodyweight":
      return "Straight down at the display so the number is sharp.";
    case "workout":
      return "Your written sets — weight and reps both need to be readable.";
    default:
      return "Whatever you want kept.";
  }
}

function BackBar({ label, onBack }: { label: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onBack}
        className="card px-3 py-1.5 text-xs font-medium"
      >
        ‹ Back
      </button>
      <span className="dim truncate text-xs">{label}</span>
    </div>
  );
}

function ResultCard({ result }: { result: { summary: string; created: string[] } }) {
  return (
    <section className="card p-4">
      <p className="text-sm leading-relaxed">{result.summary}</p>
      {result.created.length > 0 && (
        <>
          <p className="dim mt-3 text-[11px] font-medium uppercase tracking-wide">Recorded</p>
          <ul className="mt-1 space-y-0.5">
            {result.created.map((c, i) => (
              <li key={i} className="text-xs">{c}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function CameraIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
