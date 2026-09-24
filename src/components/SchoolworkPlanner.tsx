"use client";

import { useCallback, useEffect, useState } from "react";
import { DateTime } from "luxon";
import { buildDayFrame } from "@/core/day-frame";
import { buildCustomSchoolworkTradeoff, customTradeoffDraft, planSchoolwork, proposeSchoolworkTradeoffs, recommendWorkdays, suggestWorkdays, type CustomAllocation, type CustomTradeoffDraft, type PlanningDay, type SchoolworkPlan, type SchoolworkTradeoff, type WorkSession } from "@/core/schoolwork";
import { to12h } from "@/core/types";
import { CustomTradeoffEditor } from "./CustomTradeoffEditor";
import "./schoolwork-planner.css";

interface Course { id: number; code: string; name: string }
interface SchoolAssignment { id: number; title: string; kind: string; courseId: number; dueDate: string; estimatedMin: number;
  sessions: { id: number; onDate: string; durationMin: number; startMin: number | null; role: string | null; status: string }[] }
interface Draft { courseId: number; title: string; kind: "homework" | "reading" | "project" | "test"; estimatedMin: number; dueDate: string }
interface AvailableDay { date: string; availableMin: number }
interface PreviewData { date: string; courses: Course[]; assignments: SchoolAssignment[]; draft: Draft;
  options: AvailableDay[]; recommendedDates: string[]; plan: SchoolworkPlan }

const KINDS: { id: Draft["kind"]; label: string; minutes: number }[] = [
  { id: "homework", label: "Homework", minutes: 45 },
  { id: "reading", label: "Reading", minutes: 40 },
  { id: "project", label: "Project", minutes: 180 },
  { id: "test", label: "Test", minutes: 120 },
];

function prettyDate(iso: string) {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function previewDays(from: string, dueDate: string): PlanningDay[] {
  const days: PlanningDay[] = [];
  const start = DateTime.fromISO(from);
  const end = DateTime.min(DateTime.fromISO(dueDate).minus({ days: 1 }), start.plus({ days: 29 }));
  for (let day = start; day <= end; day = day.plus({ days: 1 })) {
    const date = day.toISODate()!;
    const frame = buildDayFrame(date, { sleepMode: "current", includeRoutineTradeoffs: true });
    days.push({ template: frame, notBefore: date === from ? 1000 : frame.wake });
  }
  return days;
}

export function SchoolworkPlanner({ initialDate, previewData }: { initialDate: string; previewData?: PreviewData }) {
  const [courses, setCourses] = useState<Course[]>(previewData?.courses ?? []);
  const [assignments, setAssignments] = useState<SchoolAssignment[]>(previewData?.assignments ?? []);
  const [draft, setDraft] = useState<Draft>(previewData?.draft ?? { courseId: 0, title: "", kind: "homework", estimatedMin: 45,
    dueDate: DateTime.fromISO(initialDate).plus({ days: 2 }).toISODate()! });
  const [days, setDays] = useState<AvailableDay[] | null>(previewData?.options ?? null);
  const [selected, setSelected] = useState<string[]>(previewData?.recommendedDates ?? []);
  const [plan, setPlan] = useState<SchoolworkPlan | null>(previewData?.plan ?? null);
  const [tradeoffs, setTradeoffs] = useState<SchoolworkTradeoff[]>(() => {
    if (!previewData || previewData.plan.ok) return [];
    return proposeSchoolworkTradeoffs({ id: "preview", title: previewData.draft.title,
      kind: previewData.draft.kind === "test" ? "test" : "assignment", totalMin: previewData.draft.estimatedMin,
      dueDate: previewData.draft.dueDate, selectedDates: previewData.recommendedDates },
    previewDays(previewData.date, previewData.draft.dueDate));
  });
  const [customDraft, setCustomDraft] = useState<CustomTradeoffDraft | null>(() => {
    if (!previewData || previewData.plan.ok) return null;
    return customTradeoffDraft({ id: "preview", title: previewData.draft.title,
      kind: previewData.draft.kind === "test" ? "test" : "assignment", totalMin: previewData.draft.estimatedMin,
      dueDate: previewData.draft.dueDate, selectedDates: previewData.recommendedDates },
    previewDays(previewData.date, previewData.draft.dueDate));
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const load = useCallback(async () => {
    if (previewData) return;
    try {
      const response = await fetch("/api/schoolwork", { cache: "no-store" });
      const data = await response.json() as { ok: boolean; courses?: Course[]; assignments?: SchoolAssignment[]; error?: string };
      if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not load schoolwork.");
      setCourses(data.courses ?? []);
      setAssignments(data.assignments ?? []);
      setDraft((old) => ({ ...old, courseId: old.courseId || data.courses?.[0]?.id || 0 }));
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load schoolwork."); }
  }, [previewData]);

  useEffect(() => { void load(); }, [load]);

  function edit(change: Partial<Draft>) {
    setDraft((old) => ({ ...old, ...change }));
    setDays(null); setSelected([]); setPlan(null); setTradeoffs([]); setCustomDraft(null); setError(""); setSaved("");
  }

  async function findDays() {
    if (!draft.courseId || !draft.title.trim()) { setError("Choose a class and name the work first."); return; }
    setBusy(true); setError(""); setPlan(null); setTradeoffs([]); setCustomDraft(null);
    try {
      if (previewData) {
        const planning = previewDays(initialDate, draft.dueDate);
        const available = suggestWorkdays(planning, draft.dueDate);
        const recommended = recommendWorkdays(planning, draft.dueDate, draft.estimatedMin,
          draft.kind === "test" ? "test" : "assignment");
        const refresher = DateTime.fromISO(draft.dueDate).minus({ days: 1 }).toISODate();
        setDays(available);
        setSelected(recommended.length ? recommended : draft.kind === "test" && available.some((day) => day.date === refresher && day.availableMin >= 1) ? [refresher!] : []);
      } else {
        const response = await fetch("/api/schoolwork", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "options", ...draft }) });
        const data = await response.json() as { ok: boolean; days?: AvailableDay[]; recommendedDates?: string[]; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not find workdays.");
        const available = data.days ?? [];
        const recommended = data.recommendedDates ?? [];
        const refresher = DateTime.fromISO(draft.dueDate).minus({ days: 1 }).toISODate();
        setDays(available);
        setSelected(recommended.length ? recommended : draft.kind === "test" && available.some((day) => day.date === refresher && day.availableMin >= 1) ? [refresher!] : []);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not find workdays."); }
    finally { setBusy(false); }
  }

  function toggleDay(date: string) {
    const dayBefore = DateTime.fromISO(draft.dueDate).minus({ days: 1 }).toISODate();
    if (draft.kind === "test" && date === dayBefore) return;
    setSelected((old) => old.includes(date) ? old.filter((item) => item !== date) : [...old, date].sort());
    setPlan(null); setError("");
  }

  async function previewPlan() {
    setBusy(true); setError("");
    try {
      if (previewData) {
        const request = { id: "preview", title: draft.title, kind: draft.kind === "test" ? "test" as const : "assignment" as const,
          totalMin: draft.estimatedMin, dueDate: draft.dueDate, selectedDates: selected };
        const planning = previewDays(initialDate, draft.dueDate).map((day) => ({ ...day,
          template: buildDayFrame(day.template.date, { sleepMode: "current", includeRoutineTradeoffs: true }) }));
        const nextPlan = planSchoolwork(request, planning);
        setPlan(nextPlan);
        setTradeoffs(nextPlan.ok ? [] : proposeSchoolworkTradeoffs(request, planning));
        setCustomDraft(nextPlan.ok ? null : customTradeoffDraft(request, planning));
      } else {
        const response = await fetch("/api/schoolwork", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "preview", ...draft, selectedDates: selected }) });
        const data = await response.json() as { ok: boolean; plan?: SchoolworkPlan; tradeoffs?: SchoolworkTradeoff[]; customDraft?: CustomTradeoffDraft | null; error?: string };
        if (!response.ok || !data.ok || !data.plan) throw new Error(data.error ?? "Could not preview the plan.");
        setPlan(data.plan);
        setTradeoffs(data.tradeoffs ?? []);
        setCustomDraft(data.customDraft ?? null);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not preview the plan."); }
    finally { setBusy(false); }
  }

  async function approve(sessions: WorkSession[]) {
    setBusy(true); setError("");
    try {
      if (previewData) {
        setAssignments((old) => [{ id: Date.now(), ...draft, sessions: sessions.map((session, index) => ({
          id: Date.now() + index, onDate: session.date, durationMin: session.minutes,
          startMin: session.placement.start, role: session.role, status: "planned" })),
        }, ...old]);
      } else {
        const response = await fetch("/api/schoolwork", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "approve", ...draft, selectedDates: selected, chosen: sessions }) });
        const data = await response.json() as { ok: boolean; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not save the plan.");
        await load();
      }
      setSaved(`${draft.title} is in your schedule.`);
      setDraft((old) => ({ ...old, title: "" })); setDays(null); setSelected([]); setPlan(null); setTradeoffs([]); setCustomDraft(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the plan."); }
    finally { setBusy(false); }
  }

  async function approveCustom(allocation: CustomAllocation[]) {
    setBusy(true); setError("");
    try {
      if (previewData) {
        const request = { id: "preview", title: draft.title, kind: draft.kind === "test" ? "test" as const : "assignment" as const,
          totalMin: draft.estimatedMin, dueDate: draft.dueDate, selectedDates: selected };
        const custom = buildCustomSchoolworkTradeoff(request, previewDays(initialDate, draft.dueDate), allocation);
        if (!custom) throw new Error("That custom plan no longer matches the available time.");
        setAssignments((old) => [{ id: Date.now(), ...draft, sessions: custom.sessions.map((session, index) => ({
          id: Date.now() + index, onDate: session.date, durationMin: session.minutes,
          startMin: session.placement.start, role: session.role, status: "planned" })),
        }, ...old]);
      } else {
        const response = await fetch("/api/schoolwork", { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "approve", ...draft, selectedDates: selected, customAllocation: allocation }) });
        const data = await response.json() as { ok: boolean; error?: string };
        if (!response.ok || !data.ok) throw new Error(data.error ?? "Could not save the custom plan.");
        await load();
      }
      setSaved(`${draft.title} is in your schedule.`);
      setDraft((old) => ({ ...old, title: "" })); setDays(null); setSelected([]); setPlan(null); setTradeoffs([]); setCustomDraft(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the custom plan."); }
    finally { setBusy(false); }
  }

  const dayBefore = DateTime.fromISO(draft.dueDate).minus({ days: 1 }).toISODate();
  return <div className="schoolwork-page">
    <header className="schoolwork-head"><p className="schoolwork-eyebrow">PLAN AHEAD</p><h1>Schoolwork</h1>
      <p>Put it down once. The scheduler finds time before it&apos;s due.</p></header>
    <section className="schoolwork-card" aria-labelledby="schoolwork-add-title">
      <div className="schoolwork-card-head"><h2 id="schoolwork-add-title">Add an assignment</h2><span>1 · THE DETAILS</span></div>
      <div className="schoolwork-form">
        <label>Class<select value={draft.courseId} onChange={(event) => edit({ courseId: Number(event.target.value) })}>
          {courses.length === 0 && <option value={0}>Loading your classes…</option>}
          {courses.map((course) => <option key={course.id} value={course.id}>{course.name}</option>)}</select></label>
        <label>What is it?<input value={draft.title} onChange={(event) => edit({ title: event.target.value })} placeholder="e.g. Calculus unit test" /></label>
        <div className="schoolwork-kinds" role="group" aria-label="Assignment type">{KINDS.map((kind) =>
          <button key={kind.id} type="button" className={draft.kind === kind.id ? "selected" : ""}
            onClick={() => edit({ kind: kind.id, estimatedMin: kind.minutes })}>{kind.label}</button>)}</div>
        <div className="schoolwork-form-pair"><label>Estimated minutes<input type="number" min="1" max="600" step="1" inputMode="numeric"
          value={draft.estimatedMin} onChange={(event) => edit({ estimatedMin: Number(event.target.value) })} /></label>
          <label>Due date<input type="date" min={DateTime.fromISO(initialDate).plus({ days: 1 }).toISODate()!}
            value={draft.dueDate} onChange={(event) => edit({ dueDate: event.target.value })} /></label></div>
        <button type="button" className="schoolwork-primary" disabled={busy || !draft.title.trim() || !draft.courseId}
          onClick={() => void findDays()}>{busy ? "Checking…" : "Find days for it →"}</button>
      </div>
    </section>

    {days && <section className="schoolwork-card" aria-labelledby="schoolwork-days-title"><div className="schoolwork-card-head"><h2 id="schoolwork-days-title">Choose your days</h2><span>2 · THE TIME</span></div>
      <p className="schoolwork-intro">The checked days are a suggestion. Pick days that work for you; full or due-day slots can&apos;t be chosen.</p>
      {draft.kind === "test" && <p className="schoolwork-rule">A test needs two preparation days. The day before is reserved for a refresher.</p>}
      <div className="schoolwork-days">{days.map((day) => {
        const required = draft.kind === "test" && day.date === dayBefore;
        return <button key={day.date} type="button" className={`schoolwork-day ${selected.includes(day.date) ? "selected" : ""}`}
          disabled={day.availableMin < 15 || required} onClick={() => toggleDay(day.date)} aria-pressed={selected.includes(day.date)}>
          <span className="schoolwork-day-check">{selected.includes(day.date) ? "✓" : ""}</span><strong>{prettyDate(day.date)}</strong>
          <span>{required ? "Refresher · " : ""}{day.availableMin ? `${day.availableMin} min open` : "Full"}</span></button>;
      })}</div>
      <button type="button" className="schoolwork-primary" disabled={busy || selected.length === 0}
        onClick={() => void previewPlan()}>{busy ? "Checking…" : "Preview my schedule →"}</button>
    </section>}

    {plan && <section className="schoolwork-card schoolwork-result" aria-labelledby="schoolwork-result-title"><div className="schoolwork-card-head"><h2 id="schoolwork-result-title">{plan.ok ? "Here’s the plan" : "This doesn’t fit yet"}</h2><span>3 · YOUR APPROVAL</span></div>
      {plan.ok ? <><p className="schoolwork-safe">No sacrifices needed. School, prayer, and sleep stay protected.</p>
        <div className="schoolwork-sessions">{plan.sessions.map((session, index) => <div key={`${session.date}-${index}`}>
          <span>{prettyDate(session.date)}{session.role === "refresher" ? " · Refresher" : ""}</span>
          <strong>{to12h(session.placement.start)} · {session.minutes} min</strong></div>)}</div>
        <button type="button" className="schoolwork-primary" disabled={busy} onClick={() => void approve(plan.sessions)}>
          {busy ? "Saving…" : "Approve and add to schedule"}</button></>
      : <><p className="schoolwork-no-fit">{tradeoffs.length ? "A clean plan does not fit. Nothing changes unless you approve one of these exact costs." : plan.reason === "test-days" ? "Choose exactly two days, including the day before the test." :
        plan.reason === "invalid-days" ? "Choose days before the due date." :
        `These days are short by ${plan.shortfallMin ?? 0} minutes. Choose another earlier day.`}</p>
        {tradeoffs.length > 0 && <div className="schoolwork-tradeoffs">{tradeoffs.map((option) => <article key={option.id}>
          <div className="schoolwork-tradeoff-head"><strong>{option.title}</strong><span>{option.sessions.reduce((sum, session) => sum + session.minutes, 0)} min total</span></div>
          <ul>{option.costs.map((cost, index) => <li key={`${cost.type}-${cost.blockId ?? index}`}>
            {cost.type === "friend" ? `${cost.lostMin} min less friend time in the library` :
              cost.type === "sleep" ? `${cost.lostMin} min less sleep — never below 7 hours` :
              cost.type === "winddown" ? `${cost.lostMin} min less before-sleep time` :
              `${cost.lostMin} min shorter ${cost.title ?? "routine"}`}</li>)}</ul>
          <button type="button" disabled={busy} onClick={() => void approve(option.sessions)}>Approve this option</button>
        </article>)}</div>}
        {customDraft && <CustomTradeoffEditor draft={customDraft} busy={busy} initiallyOpen={!!previewData}
          onApprove={(allocation) => void approveCustom(allocation)} />}</>}
    </section>}
    {error && <p className="schoolwork-error" role="alert">{error}</p>}
    {saved && <p className="schoolwork-saved" role="status">{saved}</p>}
    <section className="schoolwork-upcoming"><div className="schoolwork-card-head"><h2>Coming up</h2><span>{assignments.length} OPEN</span></div>
      {assignments.length === 0 ? <p className="schoolwork-intro">Nothing added yet. Your assignments will show here after you approve their plan.</p> :
        assignments.map((assignment) => <article key={assignment.id} className="schoolwork-upcoming-item"><div>
          <strong>{assignment.title}</strong><span>{courses.find((course) => course.id === assignment.courseId)?.code ?? "School"} · {assignment.kind} · due {prettyDate(assignment.dueDate)}</span></div>
          <small>{assignment.sessions.filter((session) => session.status === "done").length}/{assignment.sessions.length} sessions</small></article>)}
    </section>
  </div>;
}
