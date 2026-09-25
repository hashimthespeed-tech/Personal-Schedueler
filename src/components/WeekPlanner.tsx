"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { DayTemplate } from "@/core/adaptive";
import { mergeWeekTimeline, type WeekTask } from "@/core/week";
import { previewTaskEdit, type ExistingTask, type TaskOption } from "@/core/task-plan";
import { to12h } from "@/core/types";
import type { TodayRecurringItem } from "@/core/today-timeline";
import { DeleteConfirm } from "./DeleteConfirm";
import "./week-planner.css";

interface WeekDay { date: string; frame: DayTemplate; tasks: WeekTask[]; recurring: TodayRecurringItem[] }
interface WeekPayload { ok: true; weekStart: string; weekEnd: string; days: WeekDay[] }
interface EditDraft { duration: string; date: string; mode: "auto" | "fixed"; time: string }

function dayParts(date: string) {
  const value = DateTime.fromISO(date);
  return { weekday: value.toFormat("ccc").toUpperCase(), day: value.toFormat("d") };
}

function longDate(date: string) {
  return DateTime.fromISO(date).toFormat("cccc, LLLL d");
}

function inputTime(minute: number | null) {
  const value = minute ?? 17 * 60;
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function asMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function costLabel(option: TaskOption) {
  if (option.costs.length === 0) return "Nothing else loses time";
  return option.costs.map((cost) => cost.type === "sleep" ? `${cost.lostMin} min less sleep` :
    `${cost.lostMin} min less ${cost.title ?? (cost.type === "friend" ? "friend time" : cost.type)}`).join(" · ");
}

export function WeekPlanner({ initialDate, previewData, previewEditId, previewDeleteId }: {
  initialDate: string; previewData?: WeekPayload; previewEditId?: number; previewDeleteId?: number;
}) {
  const initialEditing = previewData?.days.flatMap((day) => day.tasks).find((task) => task.id === previewEditId) ?? null;
  const [payload, setPayload] = useState<WeekPayload | null>(previewData ?? null);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [editing, setEditing] = useState<WeekTask | null>(initialEditing);
  const [deleting, setDeleting] = useState<WeekTask | null>(
    previewData?.days.flatMap((day) => day.tasks).find((task) => task.id === previewDeleteId) ?? null);
  const [draft, setDraft] = useState<EditDraft>({ duration: String(initialEditing?.durationMin ?? 30),
    date: initialEditing?.onDate ?? initialDate, mode: "auto", time: inputTime(initialEditing?.startMin ?? null) });
  const [options, setOptions] = useState<TaskOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (previewData) return;
    try {
      const response = await fetch(`/api/week?date=${selectedDate}`, { cache: "no-store" });
      const data = await response.json() as WeekPayload & { error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not load this week.");
      setPayload(data);
      if (!data.days.some((day) => day.date === selectedDate)) setSelectedDate(data.weekStart);
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load this week."); }
  }, [previewData, selectedDate]);

  useEffect(() => { void load(); }, [load]);

  const selectedDay = payload?.days.find((day) => day.date === selectedDate) ?? payload?.days[0] ?? null;
  const entries = useMemo(() => selectedDay ? mergeWeekTimeline(selectedDay.frame, selectedDay.tasks, selectedDay.recurring) : [], [selectedDay]);
  const timed = entries.filter((entry) => entry.type === "task" || entry.type === "recurring");
  const overdue = entries.filter((entry) => entry.type === "overdue");
  const completedEarly = entries.filter((entry) => entry.type === "completed");
  const moved = entries.filter((entry) => entry.type === "moved");

  function openEditor(task: WeekTask) {
    setEditing(task);
    setDraft({ duration: String(task.durationMin), date: task.onDate, mode: "auto", time: inputTime(task.startMin) });
    setOptions(null); setError("");
  }

  function updateDraft(change: Partial<EditDraft>) {
    setDraft((old) => ({ ...old, ...change }));
    setOptions(null); setError("");
  }

  async function mark(task: WeekTask) {
    setBusy(true); setError("");
    const status = task.status === "done" ? "planned" : "done";
    try {
      if (previewData) {
        setPayload((old) => old ? { ...old, days: old.days.map((day) => ({ ...day,
          tasks: day.tasks.map((item) => item.id === task.id ? { ...item, status } : item) })) } : old);
      } else {
        const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "mark", id: task.id, status }) });
        const data = await response.json() as { ok: boolean; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not update this task.");
        await load();
        window.dispatchEvent(new Event("scheduler:tasks-changed"));
      }
      setEditing(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update this task."); }
    finally { setBusy(false); }
  }

  async function markRecurring(item: TodayRecurringItem) {
    setBusy(true); setError("");
    const status = item.status === "done" ? "planned" : "done";
    try {
      if (previewData) {
        setPayload((old) => old ? { ...old, days: old.days.map((day) => ({ ...day,
          recurring: day.recurring.map((entry) => entry.id === item.id ? { ...entry, status } : entry) })) } : old);
      } else {
        const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "mark-recurring", onDate: item.onDate, slotKey: item.slotKey, status }) });
        const data = await response.json() as { ok: boolean; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not update this item.");
        await load();
        window.dispatchEvent(new Event("scheduler:tasks-changed"));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update this item."); }
    finally { setBusy(false); }
  }

  async function deleteTask() {
    if (!deleting) return;
    setBusy(true); setError("");
    try {
      if (previewData) {
        setPayload((old) => old ? { ...old, days: old.days.map((day) => ({ ...day,
          tasks: day.tasks.filter((task) => task.id !== deleting.id) })) } : old);
      } else {
        const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "delete", id: deleting.id }) });
        const data = await response.json() as { ok: boolean; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not delete that task.");
        await load();
        window.dispatchEvent(new Event("scheduler:tasks-changed"));
      }
      setDeleting(null); setEditing(null);
    } catch (cause) {
      setDeleting(null);
      setError(cause instanceof Error ? cause.message : "Could not delete that task.");
    }
    finally { setBusy(false); }
  }

  async function previewEdit() {
    if (!editing || !payload) return;
    setBusy(true); setError(""); setOptions(null);
    try {
      const at = draft.mode === "fixed" ? asMinutes(draft.time) : undefined;
      if (previewData) {
        const target = payload.days.find((day) => day.date === draft.date);
        if (!target) throw new Error("Choose a day in this week.");
        const existing: ExistingTask[] = target.tasks.map((task) => ({ id: String(task.id), title: task.title,
          start: task.startMin, end: task.startMin === null ? null : task.startMin + task.durationMin,
          status: task.status as ExistingTask["status"] }));
        setOptions(previewTaskEdit(target.frame, { title: editing.title, durationMin: Number(draft.duration),
          kind: editing.kind === "school" ? "school" : "personal", mode: draft.mode, at }, existing,
        String(editing.id), target.frame.wake));
      } else {
        const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "preview-edit", id: editing.id, toDate: draft.date,
            durationMin: Number(draft.duration), mode: draft.mode, at }) });
        const data = await response.json() as { ok: boolean; options?: TaskOption[]; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not preview that change.");
        setOptions(data.options ?? []);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not preview that change."); }
    finally { setBusy(false); }
  }

  async function approveEdit(chosen: TaskOption) {
    if (!editing) return;
    setBusy(true); setError("");
    try {
      if (previewData) {
        const nextId = Math.max(0, ...previewData.days.flatMap((day) => day.tasks.map((task) => task.id))) + 1;
        setPayload((old) => old ? { ...old, days: old.days.map((day) => {
          const without = day.tasks.map((task) => task.id === editing.id && draft.date !== editing.onDate ?
            { ...task, status: "moved", movedToDate: draft.date } : task);
          if (draft.date === editing.onDate) return { ...day, tasks: without.map((task) => task.id === editing.id ?
            { ...task, durationMin: Number(draft.duration), startMin: chosen.start } : task) };
          if (day.date === draft.date) return { ...day, tasks: [...without, { ...editing, id: nextId, onDate: draft.date,
            durationMin: Number(draft.duration), startMin: chosen.start, status: "planned", movedToDate: null }] };
          return { ...day, tasks: without };
        }) } : old);
      } else {
        const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "approve-edit", id: editing.id, toDate: draft.date,
            durationMin: Number(draft.duration), mode: draft.mode,
            at: draft.mode === "fixed" ? asMinutes(draft.time) : undefined, chosen }) });
        const data = await response.json() as { ok: boolean; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error ?? "That option changed. Preview it again.");
        await load();
        window.dispatchEvent(new Event("scheduler:tasks-changed"));
      }
      setEditing(null); setOptions(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save that change."); }
    finally { setBusy(false); }
  }

  return <div className="week-page">
    <header className="week-head"><p>THE WEEK AHEAD</p><h1>{payload ? `${DateTime.fromISO(payload.weekStart).toFormat("LLL d")}–${DateTime.fromISO(payload.weekEnd).toFormat("d")}` : "Your week"}</h1>
      <span>Tap a day, then tap any task to adjust it.</span></header>
    {payload && <nav className="week-days" aria-label="Days this week">{payload.days.map((day) => {
      const parts = dayParts(day.date);
      const active = day.date === selectedDate;
      const open = day.tasks.filter((task) => task.status === "planned").length + day.recurring.filter((item) => item.status === "planned").length;
      return <button key={day.date} type="button" className={active ? "active" : ""} aria-current={active ? "date" : undefined}
        onClick={() => { setSelectedDate(day.date); setEditing(null); setOptions(null); }}>
        <span>{parts.weekday}</span><strong>{parts.day}</strong><i aria-label={`${open} open tasks`}>{open ? "•" : ""}</i>
      </button>;
    })}</nav>}
    {error && !editing && <p className="week-error" role="alert">{error}</p>}
    {selectedDay && <section className="week-timeline" aria-labelledby="week-selected-heading">
      <div className="week-selected-head"><div><p>SELECTED DAY</p><h2 id="week-selected-heading">{longDate(selectedDay.date)}</h2></div>
        <span>{selectedDay.tasks.filter((task) => task.status === "done").length + selectedDay.recurring.filter((item) => item.status === "done").length}/{selectedDay.tasks.filter((task) => task.status === "done" || task.status === "planned").length + selectedDay.recurring.length} done</span></div>
      <div id="week-actionable-list" className="week-list">{timed.map((entry) => entry.type === "recurring" ? <button key={entry.id} type="button" disabled={busy}
        className={`week-entry week-task ${entry.recurring?.status === "done" ? "is-done" : ""}`} onClick={() => entry.recurring && void markRecurring(entry.recurring)}>
        <time>{to12h(entry.startMin!)}</time><span className="week-task-check">{entry.recurring?.status === "done" ? "✓" : ""}</span>
        <span><strong>{entry.title}</strong><small>{entry.durationMin} min · {entry.recurring?.kind === "prayer" ? "Prayer" : entry.recurring?.kind === "wrestling" ? "Wrestling" : "Workout"}</small></span><b aria-hidden="true" /></button>
        : <button key={entry.id} type="button" className={`week-entry week-task ${entry.task?.status === "done" ? "is-done" : ""}`}
          onClick={() => entry.task && openEditor(entry.task)}><time>{to12h(entry.startMin!)}</time><span className="week-task-check">{entry.task?.status === "done" ? "✓" : ""}</span>
          <span><strong>{entry.title}</strong><small>{entry.durationMin} min{entry.task?.kind === "school" ? " · School" : ""}{entry.task?.workRole === "refresher" ? " · Refresher" : ""}</small></span><b>›</b></button>)}</div>
      {overdue.length > 0 && <div className="week-overdue"><h3>Overdue / needs a time <span>{overdue.length}</span></h3>{overdue.map((entry) => <button key={entry.id} type="button" onClick={() => entry.task && openEditor(entry.task)}>
        <span><strong>{entry.title}</strong><small>{entry.durationMin} min · Not placed</small></span><b>›</b></button>)}</div>}
      {completedEarly.length > 0 && <div id="completed-early" className="week-completed-early"><h3>Completed early <span>{completedEarly.length}</span></h3>
        {completedEarly.map((entry) => <button key={entry.id} type="button" onClick={() => entry.task && openEditor(entry.task)}>
          <span className="week-task-check">✓</span><span><strong>{entry.title}</strong><small>{entry.durationMin} min · Space reclaimed</small></span><b>›</b></button>)}</div>}
      {moved.length > 0 && <p className="week-moved">{moved.length} task{moved.length === 1 ? " was" : "s were"} moved from this day and excluded from completion.</p>}
    </section>}
    {!payload && !error && <p className="week-loading">Loading your week…</p>}

    {editing && <div className="week-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(null); }}>
      <section className="week-sheet" role="dialog" aria-modal="true" aria-labelledby="week-edit-title">
        <div className="week-sheet-head"><div><p>EDIT THIS TASK</p><h2 id="week-edit-title">{editing.title}</h2></div><button type="button" aria-label="Close" onClick={() => setEditing(null)}>×</button></div>
        <button type="button" className={`week-complete ${editing.status === "done" ? "is-done" : ""}`} disabled={busy} onClick={() => void mark(editing)}>
          <span>{editing.status === "done" ? "✓" : ""}</span>{editing.status === "done" ? "Mark unfinished" : "Mark complete"}</button>
        <button type="button" className="week-delete" disabled={busy} onClick={() => setDeleting(editing)}>Delete task forever</button>
        {editing.status === "planned" && <><div className="week-form"><div className="week-form-pair"><label>Minutes<input type="number" min="5" max="480" step="5" inputMode="numeric" value={draft.duration} onChange={(event) => updateDraft({ duration: event.target.value })} /></label>
          <label>Day<input type="date" value={draft.date} onChange={(event) => updateDraft({ date: event.target.value })} /></label></div>
          <div className="week-modes" role="group" aria-label="How to place this task"><button type="button" className={draft.mode === "auto" ? "selected" : ""} onClick={() => updateDraft({ mode: "auto" })}>Find a time</button>
            <button type="button" className={draft.mode === "fixed" ? "selected" : ""} onClick={() => updateDraft({ mode: "fixed" })}>Set a time</button></div>
          {draft.mode === "fixed" && <label>Start time<input type="time" value={draft.time} onChange={(event) => updateDraft({ time: event.target.value })} /></label>}
          <button type="button" className="week-preview" disabled={busy || Number(draft.duration) < 5} onClick={() => void previewEdit()}>{busy ? "Checking…" : "Preview this change →"}</button></div>
          {error && <p className="week-error" role="alert">{error}</p>}
          {options && <div className="week-options"><h3>{options.length ? "Choose an exact option" : "No safe time fits"}</h3>{options.map((option, index) => <div key={`${option.start}-${index}`}>
            <span><strong>{option.start === null ? "Needs a time" : `${to12h(option.start)}–${to12h(option.end!)}`}</strong><small className={option.costs.length ? "has-cost" : ""}>{costLabel(option)}</small></span>
            <button type="button" disabled={busy} onClick={() => void approveEdit(option)}>Approve</button></div>)}</div>}</>}
      </section>
    </div>}
    {deleting && <DeleteConfirm title={deleting.title} noun="task" busy={busy}
      onCancel={() => setDeleting(null)} onConfirm={() => void deleteTask()} />}
  </div>;
}
