"use client";

import { useCallback, useEffect, useState } from "react";

interface Course {
  id: number;
  code: string;
  name: string;
  period: number;
}

interface Assignment {
  id: number;
  courseId: number;
  title: string;
  kind: string;
  dueDate: string | null;
  estimatedMin: number;
}

const KINDS = [
  { id: "homework", label: "Homework", min: 45 },
  { id: "reading", label: "Reading", min: 40 },
  { id: "test", label: "Test", min: 120 },
  { id: "project", label: "Project", min: 180 },
] as const;

function isoIn(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function dueLabel(iso: string | null): string {
  if (!iso) return "no date";
  const days = Math.round(
    (new Date(`${iso}T12:00:00`).getTime() - new Date().setHours(12, 0, 0, 0)) / 86_400_000,
  );
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `${days} days`;
}

/**
 * Adding something that's due.
 *
 * It used to photograph a worksheet and pay a model to read it. That cost money
 * on every capture and guessed at the due date, which is the one field that has
 * to be right. Four taps is faster than waiting for an answer, and it is never
 * wrong about Thursday.
 *
 * The teacher writes it on a whiteboard and says it out loud once. The whole
 * job is getting it off that board before it's gone, so nothing here blocks:
 * a title and a course is a valid entry, everything else has a default.
 */
export function CaptureForm() {
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [open, setOpen] = useState<Assignment[]>([]);

  const [courseId, setCourseId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<(typeof KINDS)[number]["id"]>("homework");
  const [dueDate, setDueDate] = useState(isoIn(1));
  const [minutes, setMinutes] = useState(45);

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/capture");
    if (!res.ok) return setError("Could not load your courses.");
    const data = (await res.json()) as { courses: Course[]; assignments: Assignment[] };
    setCourses(data.courses);
    setOpen(data.assignments);
    setCourseId((current) => current ?? data.courses[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function pickKind(next: (typeof KINDS)[number]) {
    setKind(next.id);
    setMinutes(next.min);
    // a test is rarely due tomorrow; a worksheet almost always is
    if (next.id === "test" || next.id === "project") setDueDate(isoIn(7));
  }

  async function add() {
    if (!courseId || title.trim().length === 0 || busy) return;
    setBusy(true);
    setError("");

    try {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "add",
          courseId,
          title: title.trim(),
          kind,
          dueDate: dueDate || null,
          estimatedMin: minutes,
        }),
      });

      const data = (await res.json()) as { ok: boolean; error?: string; duplicate?: boolean };
      if (!data.ok) {
        setError(data.error ?? "That didn't save.");
        return;
      }

      setSaved(data.duplicate ? "Already on the list." : `Added "${title.trim()}".`);
      setTitle("");
      await load();
      setTimeout(() => setSaved(""), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  async function close(id: number) {
    setOpen((current) => current.filter((a) => a.id !== id));
    await fetch("/api/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "close", id, status: "done" }),
    });
    await load();
  }

  if (!courses) return <p className="dim card p-4 text-sm">Loading…</p>;

  const byId = new Map(courses.map((c) => [c.id, c]));

  return (
    <div className="space-y-5">
      <section className="card space-y-3 p-4">
        <div className="flex flex-wrap gap-1.5">
          {courses.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCourseId(c.id)}
              className="rounded-full px-3 py-1.5 text-xs font-medium"
              style={
                c.id === courseId
                  ? { background: "var(--fg)", color: "var(--bg)" }
                  : { border: "1px solid var(--line)", color: "var(--dim)" }
              }
            >
              {c.code}
            </button>
          ))}
        </div>

        <input
          id="assignment-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void add();
          }}
          placeholder="Ch 14 questions 1–20"
          autoComplete="off"
          className="w-full rounded-xl px-3 py-2.5 text-sm outline-none"
          style={{ background: "var(--bg)", border: "1px solid var(--line)", color: "var(--fg)" }}
        />

        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => pickKind(k)}
              className="rounded-lg px-3 py-1.5 text-xs font-medium"
              style={
                k.id === kind
                  ? { background: "var(--color-school)", color: "#fff" }
                  : { border: "1px solid var(--line)", color: "var(--dim)" }
              }
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="assignment-due" className="dim text-xs">
            Due
          </label>
          <input
            id="assignment-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="rounded-lg px-2.5 py-1.5 text-xs"
            style={{ background: "var(--bg)", border: "1px solid var(--line)", color: "var(--fg)" }}
          />
          {[0, 1, 2, 7].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDueDate(isoIn(d))}
              className="dim rounded-lg px-2.5 py-1.5 text-xs"
              style={{ border: "1px solid var(--line)" }}
            >
              {d === 0 ? "Today" : d === 1 ? "Tomorrow" : `+${d}d`}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <label htmlFor="assignment-min" className="dim shrink-0 text-xs">
            About {minutes} min
          </label>
          <input
            id="assignment-min"
            type="range"
            min={10}
            max={180}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className="flex-1"
          />
        </div>

        <button
          type="button"
          onClick={add}
          disabled={busy || !courseId || title.trim().length === 0}
          className="w-full rounded-xl py-2.5 text-sm font-medium disabled:opacity-40"
          style={{ background: "var(--fg)", color: "var(--bg)" }}
        >
          {busy ? "Adding…" : "Add"}
        </button>

        {saved && <p className="dim text-xs">{saved}</p>}
        {error && <p className="text-xs text-red-500">{error}</p>}
      </section>

      <section>
        <h2 className="dim mb-2 text-[11px] font-medium uppercase tracking-wide">
          Open ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="dim card p-4 text-sm">
            Nothing due. This is also what it looks like when you forgot to write something down.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {open.map((a) => {
              const course = byId.get(a.courseId);
              const overdue = a.dueDate !== null && a.dueDate < isoIn(0);
              return (
                <li key={a.id} className="card flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{a.title}</p>
                    <p className="dim text-xs">
                      {course?.code ?? "?"} · {a.kind} · {a.estimatedMin} min ·{" "}
                      <span style={overdue ? { color: "var(--color-physique)" } : undefined}>
                        {dueLabel(a.dueDate)}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => close(a.id)}
                    aria-label={`Mark ${a.title} done`}
                    className="shrink-0 rounded-lg px-3 py-1.5 text-sm"
                    style={{ border: "1px solid var(--line)" }}
                  >
                    ✓
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
