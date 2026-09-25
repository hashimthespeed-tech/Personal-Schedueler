"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildDayFrame } from "@/core/day-frame";
import { previewTask, type TaskOption } from "@/core/task-plan";
import type { DayTemplate } from "@/core/adaptive";
import { mergeTodayTimeline, type TodayRecurringItem, type TodayTask } from "@/core/today-timeline";
import { to12h } from "@/core/types";
import { DeleteConfirm } from "./DeleteConfirm";
import "./adaptive-day-view.css";

export type DayTask = TodayTask;

interface DayPayload { ok: true; date: string; frame: DayTemplate; tasks: DayTask[]; recurring: TodayRecurringItem[] }
interface Draft { title: string; duration: string; date: string; kind: "school" | "personal"; mode: "auto" | "fixed" | "past"; time: string }

function minutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function costLabel(option: TaskOption) {
  if (option.costs.length === 0) return "No time taken from anything else";
  return option.costs.map((cost) => {
    if (cost.type === "friend") return `${cost.lostMin} min less with friends in the library`;
    if (cost.type === "sleep") return `${cost.lostMin} min less sleep · ${Math.floor(option.remainingSleepMin / 60)}h ${option.remainingSleepMin % 60}m left`;
    if (cost.type === "winddown") return `${cost.lostMin} min less wind-down time`;
    return `${cost.lostMin} min less ${cost.title ?? "routine time"}`;
  }).join(" · ");
}

export function AdaptiveDayView({ initialDate, previewData, previewDeleteId }: {
  initialDate: string; previewData?: DayPayload; previewDeleteId?: number;
}) {
  const [date, setDate] = useState(initialDate);
  const [payload, setPayload] = useState<DayPayload | null>(previewData ?? null);
  const [open, setOpen] = useState(false);
  const [moving, setMoving] = useState<DayTask | null>(null);
  const [deleting, setDeleting] = useState<DayTask | null>(
    previewData?.tasks.find((task) => task.id === previewDeleteId) ?? null);
  const [draft, setDraft] = useState<Draft>({ title: "", duration: "30", date: initialDate, kind: "personal", mode: "auto", time: "17:00" });
  const [options, setOptions] = useState<TaskOption[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (on: string) => {
    if (previewData) return;
    try {
      const response = await fetch(`/api/tasks?date=${on}`, { cache: "no-store" });
      const data = await response.json() as DayPayload & { error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not load your tasks.");
      setPayload(data);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your tasks.");
    }
  }, [previewData]);

  useEffect(() => { void load(date); }, [date, load]);

  const tasks = payload?.tasks ?? [];
  const recurring = payload?.recurring ?? [];
  const scheduled = useMemo(() => mergeTodayTimeline(tasks, recurring), [tasks, recurring]);
  const overdue = tasks.filter((task) => (task.status === "planned" || task.status === "done") && task.startMin === null);
  const movedCount = tasks.filter((task) => task.status === "moved").length;
  const doneCount = tasks.filter((task) => task.status === "done").length + recurring.filter((item) => item.status === "done").length;
  const activeCount = tasks.filter((task) => task.status === "done" || task.status === "planned").length + recurring.length;

  function beginAdd() {
    setMoving(null);
    setDraft({ title: "", duration: "30", date, kind: "personal", mode: "auto", time: "17:00" });
    setOptions(null); setError(""); setOpen(true);
  }

  function beginMove(task: DayTask) {
    setMoving(task);
    setDraft({ title: task.title, duration: String(task.durationMin), date,
      kind: task.kind === "school" ? "school" : "personal", mode: "auto", time: "17:00" });
    setOptions(null); setError(""); setOpen(true);
  }

  async function mark(task: DayTask) {
    setBusy(true); setError("");
    const status = task.status === "done" ? "planned" : "done";
    try {
      if (previewData) {
        setPayload((old) => old ? { ...old, tasks: old.tasks.map((item) => item.id === task.id ? { ...item, status } : item) } : old);
      } else {
        const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "mark", id: task.id, status }) });
        if (!response.ok) throw new Error("Could not save that check-off.");
        await load(date);
        window.dispatchEvent(new Event("scheduler:tasks-changed"));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save that check-off."); }
    finally { setBusy(false); }
  }

  async function markRecurring(item: TodayRecurringItem) {
    setBusy(true); setError("");
    const status = item.status === "done" ? "planned" : "done";
    try {
      if (previewData) {
        setPayload((old) => old ? { ...old, recurring: old.recurring.map((entry) =>
          entry.slotKey === item.slotKey ? { ...entry, status } : entry) } : old);
      } else {
        const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "mark-recurring", onDate: date, slotKey: item.slotKey, status }) });
        if (!response.ok) throw new Error("Could not save that check-off.");
        await load(date);
        window.dispatchEvent(new Event("scheduler:tasks-changed"));
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save that check-off."); }
    finally { setBusy(false); }
  }

  async function deleteTask() {
    if (!deleting) return;
    setBusy(true); setError("");
    try {
      if (previewData) {
        setPayload((old) => old ? { ...old, tasks: old.tasks.filter((task) => task.id !== deleting.id) } : old);
      } else {
        const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "delete", id: deleting.id }) });
        const data = await response.json() as { ok: boolean; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not delete that task.");
        await load(date);
        window.dispatchEvent(new Event("scheduler:tasks-changed"));
      }
      setDeleting(null);
    } catch (cause) {
      setDeleting(null);
      setError(cause instanceof Error ? cause.message : "Could not delete that task.");
    }
    finally { setBusy(false); }
  }

  async function preview() {
    setBusy(true); setError(""); setOptions(null);
    try {
      const at = draft.mode === "fixed" ? minutes(draft.time) : undefined;
      if (previewData) {
        const frame = buildDayFrame(draft.date, { sleepMode: "current" });
        const existing = (draft.date === date ? tasks : []).map((task) => ({ id: String(task.id), title: task.title,
          start: task.startMin, end: task.startMin === null ? null : task.startMin + task.durationMin,
          status: task.status as "planned" | "done" | "moved" | "cancelled" }));
        setOptions(previewTask(frame, { title: draft.title, durationMin: Number(draft.duration), kind: draft.kind,
          mode: draft.mode, at }, existing, frame.wake));
      } else {
        const body = moving ? { action: "preview-move", id: moving.id, toDate: draft.date, mode: draft.mode, at }
          : { action: "preview", date: draft.date, title: draft.title.trim(), durationMin: Number(draft.duration),
            kind: draft.kind, mode: draft.mode, at };
        const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const data = await response.json() as { ok: boolean; options?: TaskOption[]; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not find a time.");
        setOptions(data.options ?? []);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not find a time."); }
    finally { setBusy(false); }
  }

  async function approve(chosen: TaskOption) {
    setBusy(true); setError("");
    try {
      if (previewData) {
        const next: DayTask = { id: Date.now(), title: draft.title.trim(), onDate: draft.date,
          durationMin: Number(draft.duration), startMin: chosen.start, kind: draft.kind,
          status: "planned", dueDate: moving?.dueDate ?? null, movedToDate: null };
        setPayload((old) => old ? { ...old, tasks: [
          ...old.tasks.map((task) => moving && task.id === moving.id ? { ...task, status: "moved", movedToDate: draft.date } : task),
          ...(draft.date === date ? [next] : []),
        ] } : old);
      } else {
        const body = moving ? { action: "approve-move", id: moving.id, toDate: draft.date, mode: draft.mode,
          at: draft.mode === "fixed" ? minutes(draft.time) : undefined, chosen }
          : { action: "approve", date: draft.date, title: draft.title.trim(), durationMin: Number(draft.duration),
            kind: draft.kind, mode: draft.mode, at: draft.mode === "fixed" ? minutes(draft.time) : undefined, chosen };
        const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const data = await response.json() as { ok: boolean; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error ?? "That time changed. Please preview again.");
        await load(date);
        window.dispatchEvent(new Event("scheduler:tasks-changed"));
      }
      setOpen(false); setOptions(null); setMoving(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save your task."); }
    finally { setBusy(false); }
  }

  return <section className="adaptive-day" aria-labelledby="adaptive-heading">
    <div className="adaptive-head"><div><p className="adaptive-eyebrow">YOUR PLAN</p><h2 id="adaptive-heading">Today&apos;s tasks</h2>
      <p>{activeCount ? `${doneCount} of ${activeCount} done` : "A clear day so far"}{movedCount ? ` · ${movedCount} moved` : ""}</p></div>
      <button type="button" className="adaptive-add" onClick={beginAdd}>+ Add</button></div>
    {error && !open && <p className="adaptive-error" role="alert">{error}</p>}
    {scheduled.length === 0 && overdue.length === 0 ? <div className="adaptive-empty">No tasks assigned yet. Add one with just a name and duration.</div> : null}
    <div className="adaptive-task-list">{scheduled.map((item) => {
      const recurringItem = item.source === "recurring" ? item : null;
      const savedTask = item.source === "task" ? { ...item, id: item.taskId } : null;
      const kindLabel = item.source === "recurring"
        ? item.kind === "prayer" ? "Prayer" : item.kind === "wrestling" ? "Wrestling" : "Workout"
        : item.kind === "school" ? "School" : "";
      return <article key={item.id} className={`adaptive-task ${item.status === "done" ? "is-done" : ""}`}>
        <button type="button" className="adaptive-check" aria-label={`${item.status === "done" ? "Unmark" : "Complete"} ${item.title}`}
          aria-pressed={item.status === "done"} disabled={busy}
          onClick={() => recurringItem ? void markRecurring(recurringItem) : savedTask ? void mark(savedTask) : undefined}>
          {item.status === "done" ? "✓" : ""}</button>
        <div className="adaptive-task-main"><strong>{item.title}</strong><span>{to12h(item.startMin!)} · {item.durationMin} min{kindLabel ? ` · ${kindLabel}` : ""}</span></div>
        {savedTask && <div className="adaptive-task-actions">{savedTask.status === "planned" &&
          <button type="button" className="adaptive-move" onClick={() => beginMove(savedTask)}>Move</button>}
          <button type="button" className="adaptive-delete" onClick={() => setDeleting(savedTask)}>Delete</button></div>}
      </article>;
    })}</div>
    {overdue.length > 0 && <div className="adaptive-overdue"><h3>Overdue / needs a time <span>{overdue.length}</span></h3>
      {overdue.map((task) => <article key={task.id} className={`adaptive-task ${task.status === "done" ? "is-done" : ""}`}>
        <button type="button" className="adaptive-check" aria-label={`${task.status === "done" ? "Unmark" : "Complete"} ${task.title}`}
          aria-pressed={task.status === "done"} disabled={busy} onClick={() => void mark(task)}>{task.status === "done" ? "✓" : ""}</button>
        <div className="adaptive-task-main"><strong>{task.title}</strong><span>{task.durationMin} min · Not placed yet</span></div>
        <div className="adaptive-task-actions">{task.status === "planned" &&
          <button type="button" className="adaptive-move" onClick={() => beginMove(task)}>Place</button>}
          <button type="button" className="adaptive-delete" onClick={() => setDeleting(task)}>Delete</button></div>
      </article>)}
    </div>}

    {open && <div className="adaptive-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="adaptive-modal" role="dialog" aria-modal="true" aria-labelledby="adaptive-modal-title">
        <div className="adaptive-modal-head"><div><p className="adaptive-eyebrow">{moving ? "MOVE A TASK" : "QUICK ADD"}</p><h2 id="adaptive-modal-title">{moving ? moving.title : "Make room for it"}</h2></div>
          <button type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button></div>
        <div className="adaptive-form">
          {!moving && <label>What is it?<input autoFocus value={draft.title} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); setOptions(null); }} placeholder="e.g. Finish history notes" /></label>}
          <div className="adaptive-form-pair"><label>Minutes<input type="number" min="5" max="480" step="5" inputMode="numeric" disabled={!!moving}
            value={draft.duration} onChange={(event) => { setDraft({ ...draft, duration: event.target.value }); setOptions(null); }} /></label>
            <label>Day<input type="date" value={draft.date} onChange={(event) => { setDraft({ ...draft, date: event.target.value }); setOptions(null); }} /></label></div>
          {!moving && <label>Type<select value={draft.kind} onChange={(event) => { setDraft({ ...draft, kind: event.target.value as Draft["kind"] }); setOptions(null); }}>
            <option value="personal">Personal</option><option value="school">School work</option></select></label>}
          <div className="adaptive-modes" role="group" aria-label="How to place this task">
            {([ ["auto", "Find a time"], ["fixed", "Set a time"], ["past", "Already passed"] ] as const).map(([mode, label]) =>
              <button key={mode} type="button" className={draft.mode === mode ? "selected" : ""} onClick={() => { setDraft({ ...draft, mode }); setOptions(null); }}>{label}</button>)}</div>
          {draft.mode === "fixed" && <label>Start time<input type="time" value={draft.time} onChange={(event) => { setDraft({ ...draft, time: event.target.value }); setOptions(null); }} /></label>}
          {draft.mode === "past" && <p className="adaptive-hint">This will appear in the overdue area until you complete it or give it a time.</p>}
          <button type="button" className="adaptive-preview-button" disabled={busy || !draft.title.trim() || Number(draft.duration) < 5}
            onClick={() => void preview()}>{busy ? "Checking…" : "Preview options →"}</button>
        </div>
        {error && <p className="adaptive-error" role="alert">{error}</p>}
        {options && <div className="adaptive-options"><h3>{options.length ? "Choose what works for you" : "No safe time fits"}</h3>
          {options.length === 0 && <p>Try another day or a different time. Your protected commitments stay protected.</p>}
          {options.map((option, index) => <div className="adaptive-option" key={`${option.start}-${index}`}>
            <div><strong>{option.start === null ? "Add to overdue" : `${to12h(option.start)} – ${to12h(option.end!)}`}</strong>
              <span className={option.costs.length ? "has-cost" : ""}>{costLabel(option)}</span></div>
            <button type="button" disabled={busy} onClick={() => void approve(option)}>Approve</button>
          </div>)}
        </div>}
      </section>
    </div>}
    {deleting && <DeleteConfirm title={deleting.title} noun="task" busy={busy}
      onCancel={() => setDeleting(null)} onConfirm={() => void deleteTask()} />}
  </section>;
}
