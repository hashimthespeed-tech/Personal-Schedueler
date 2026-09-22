"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { FiniteProgress, Goal, GoalCategory, MonthlyProgress } from "@/core/goals";

export type GoalView = Goal & { progress: FiniteProgress | MonthlyProgress };
type GoalResponse = { ok: true; today: string; goals: GoalView[] } | { ok: false; error?: string };

const AREAS: { id: GoalCategory; label: string; short: string }[] = [
  { id: "school", label: "School", short: "SC" },
  { id: "religion", label: "Religion", short: "RE" },
  { id: "fitness", label: "Fitness", short: "FI" },
  { id: "ai", label: "AI", short: "AI" },
  { id: "money", label: "Money", short: "MO" },
];

function area(category: GoalCategory) {
  return AREAS.find((item) => item.id === category) ?? AREAS[0]!;
}

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function Trend({ points, title }: { points: { date: string; value: number }[]; title: string }) {
  if (points.length === 0) return <div className="goal-trend-empty">Log a day to start your graph</div>;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(1, max - min);
  const coords = points.map((point, index) => ({
    x: points.length === 1 ? 50 : 6 + (index / (points.length - 1)) * 88,
    y: 43 - ((point.value - min) / spread) * 31,
  }));
  return (
    <svg className="goal-trend" viewBox="0 0 100 50" role="img" aria-label={`${title} trend: ${points.map((p) => `${p.date} ${p.value}`).join(", ")}`}>
      <path d="M 0 44 H 100" className="goal-trend-grid" />
      {coords.length > 1 && <polyline points={coords.map((p) => `${p.x},${p.y}`).join(" ")} className="goal-trend-line" />}
      {coords.map((p, i) => <circle key={`${points[i]!.date}-${i}`} cx={p.x} cy={p.y} r="2.2" className="goal-trend-dot" />)}
    </svg>
  );
}

function GoalCard({ goal, today, onSaved, onFinished }: {
  goal: GoalView;
  today: string;
  onSaved: () => Promise<void>;
  onFinished: (goal: GoalView) => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isFinite = goal.kind === "finite";
  const finite = isFinite ? goal.progress as FiniteProgress : null;
  const monthly = !isFinite ? goal.progress as MonthlyProgress : null;
  const percent = finite ? Math.round(finite.progress * 100) : monthly ?
    Math.round((monthly.metDays / Math.max(1, monthly.metDays + monthly.missedDays + monthly.unloggedDays)) * 100) : 0;
  const points = finite?.points ?? monthly?.points ?? [];

  async function saveLog() {
    const numeric = Number(value);
    if (value.trim() === "" || !Number.isFinite(numeric) || numeric < 0) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/goals", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "log", id: goal.id, onDate: today, value: numeric }) });
      const data = await response.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Could not save this check-in.");
      setValue("");
      setEditing(false);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this check-in.");
    } finally { setBusy(false); }
  }

  return (
    <article className="goal-card" style={{ "--goal-accent": `var(--color-${goal.category === "religion" ? "deen" : goal.category === "fitness" ? "physique" : goal.category})` } as React.CSSProperties}>
      <div className="goal-card-top">
        <div className="goal-card-icon" aria-hidden="true">{area(goal.category).short}</div>
        <div className="goal-card-heading">
          <p className="goal-card-category">{area(goal.category).label} · {isFinite ? "Target" : "Ongoing"}</p>
          <h3>{goal.title}</h3>
        </div>
        <span className="goal-card-number">{percent}%</span>
      </div>

      <div className="goal-bar" role="progressbar" aria-label={`${goal.title} progress`} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${percent}%` }} />
      </div>

      <div className="goal-card-detail">
        {finite ? (
          <span>{formatNumber(finite.value)} / {formatNumber(goal.target)} {goal.unit}</span>
        ) : monthly ? (
          <span>{monthly.metDays} days met · {monthly.livesRemaining} {monthly.livesRemaining === 1 ? "life" : "lives"} left this month</span>
        ) : null}
        <span>{points.length ? `${points.length} logged` : "No data yet"}</span>
      </div>
      {monthly && monthly.unloggedDays > 0 && <p className="goal-unknown">{monthly.unloggedDays} {monthly.unloggedDays === 1 ? "day" : "days"} not logged yet</p>}
      <Trend points={points} title={goal.title} />

      {!goal.completedOn && (
        <div className="goal-card-actions">
          {editing ? (
            <div className="goal-log-row">
              <input type="number" min="0" step="any" inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value)}
                placeholder={goal.kind === "ongoing" ? `Today’s ${goal.unit}` : goal.unit} aria-label={`Log ${goal.unit} for ${goal.title}`} />
              <button type="button" onClick={saveLog} disabled={busy || value.trim() === ""}>Save</button>
              <button type="button" className="goal-text-button" onClick={() => setEditing(false)}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="goal-text-button" onClick={() => setEditing(true)}>+ Log progress</button>
          )}
          {finite?.reached && <button type="button" className="goal-complete-button" onClick={() => void onFinished(goal)}>Complete goal →</button>}
        </div>
      )}
      {error && <p className="goal-error">{error}</p>}
    </article>
  );
}

interface CreateDraft {
  category: GoalCategory;
  title: string;
  kind: "finite" | "ongoing";
  target: string;
  unit: string;
  allowedMisses: string;
  measure: "sum" | "latest" | "daily-number";
  startValue: string;
}

const EMPTY_DRAFT: CreateDraft = { category: "fitness", title: "", kind: "finite", target: "", unit: "", allowedMisses: "2", measure: "sum", startValue: "" };

export function GoalsDashboard({ previewData }: { previewData?: { today: string; goals: GoalView[] } }) {
  const [goals, setGoals] = useState<GoalView[]>([]);
  const [today, setToday] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"active" | "completed">("active");
  const [category, setCategory] = useState<GoalCategory | "all">("all");
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<CreateDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [nextGoal, setNextGoal] = useState<GoalView | null>(null);

  const load = useCallback(async () => {
    if (previewData) {
      setGoals(previewData.goals);
      setToday(previewData.today);
      setLoading(false);
      return;
    }
    try {
      const response = await fetch("/api/goals", { cache: "no-store" });
      const data = await response.json() as GoalResponse;
      if (!response.ok || !data.ok) throw new Error(!data.ok ? data.error ?? "Could not load goals." : "Could not load goals.");
      setGoals(data.goals);
      setToday(data.today);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load goals.");
    } finally { setLoading(false); }
  }, [previewData]);

  useEffect(() => { void load(); }, [load]);

  const active = goals.filter((goal) => !goal.completedOn);
  const completed = goals.filter((goal) => !!goal.completedOn);
  const visible = (tab === "active" ? active : completed).filter((goal) => category === "all" || goal.category === category);
  const grouped = useMemo(() => AREAS.map((item) => ({ area: item, goals: visible.filter((goal) => goal.category === item.id) })), [visible]);

  async function createGoal() {
    const target = Number(draft.target);
    if (!draft.title.trim() || !draft.unit.trim() || !Number.isFinite(target) || target <= 0) return;
    setSaving(true);
    setError("");
    try {
      const body = { action: "create", category: draft.category, title: draft.title.trim(), kind: draft.kind,
        measure: draft.kind === "ongoing" ? "daily-number" : draft.measure === "latest" ? "latest" : "sum",
        target, comparison: "at-least", unit: draft.unit.trim(),
        ...(draft.kind === "finite" && draft.measure === "latest" && draft.startValue.trim() !== "" ? { startValue: Number(draft.startValue) } : {}),
        ...(draft.kind === "ongoing" ? { allowedMisses: Number(draft.allowedMisses) } : {}) };
      const response = await fetch("/api/goals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Could not create goal.");
      setCreating(false);
      setNextGoal(null);
      setDraft(EMPTY_DRAFT);
      setTab("active");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create goal.");
    } finally { setSaving(false); }
  }

  async function finish(goal: GoalView) {
    setError("");
    try {
      const response = await fetch("/api/goals", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "finish", id: goal.id }) });
      const data = await response.json() as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? "Could not finish goal.");
      await load();
      setNextGoal(goal);
      setDraft({ category: goal.category, title: goal.title, kind: "finite", target: "", unit: goal.unit,
        allowedMisses: "2", measure: goal.kind === "finite" && goal.measure === "latest" ? "latest" : "sum",
        startValue: goal.kind === "finite" && goal.measure === "latest" ? String((goal.progress as FiniteProgress).value) : "" });
      setCreating(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not finish goal."); }
  }

  return (
    <div className="goals-page">
      <header className="goals-header">
        <div>
          <p className="goals-eyebrow">THE LONG VIEW</p>
          <h1>Goals</h1>
          <p className="goals-subtitle">See the work add up, one day at a time.</p>
        </div>
        <button type="button" className="goals-add" onClick={() => { setNextGoal(null); setDraft(EMPTY_DRAFT); setCreating(true); }}>+ New goal</button>
      </header>

      <div className="goals-summary">
        <div><strong>{active.length}</strong><span>active goals</span></div>
        <div><strong>{completed.length}</strong><span>completed</span></div>
        <div><strong>{new Set(active.map((goal) => goal.category)).size}</strong><span>areas in focus</span></div>
      </div>

      <div className="goals-switch" role="tablist" aria-label="Goal status">
        <button type="button" role="tab" aria-selected={tab === "active"} className={tab === "active" ? "selected" : ""} onClick={() => setTab("active")}>Active <span>{active.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === "completed"} className={tab === "completed" ? "selected" : ""} onClick={() => setTab("completed")}>Completed <span>{completed.length}</span></button>
      </div>

      <div className="goals-filters" aria-label="Filter by area">
        <button type="button" className={category === "all" ? "selected" : ""} onClick={() => setCategory("all")}>All areas</button>
        {AREAS.map((item) => <button key={item.id} type="button" className={category === item.id ? "selected" : ""} onClick={() => setCategory(item.id)}>{item.label}</button>)}
      </div>

      {error && <p className="goal-error" role="alert">{error}</p>}
      {loading ? <p className="goals-empty">Loading your goals…</p> : visible.length === 0 ? (
        <div className="goals-empty">
          <strong>{tab === "completed" ? "Nothing completed yet" : "No goals in this view yet"}</strong>
          <span>{tab === "completed" ? "Finished goals will stay here with their history." : "Add a goal and start tracking what matters to you."}</span>
        </div>
      ) : grouped.filter((group) => group.goals.length > 0).map((group) => (
        <section key={group.area.id} className="goals-area">
          <div className="goals-area-head"><h2>{group.area.label}</h2><span>{group.goals.length} {group.goals.length === 1 ? "goal" : "goals"}</span></div>
          <div className="goals-grid">{group.goals.map((goal) => <GoalCard key={goal.id} goal={goal} today={today} onSaved={load} onFinished={finish} />)}</div>
        </section>
      ))}

      {creating && <div className="goal-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(false); }}>
        <section className="goal-modal" role="dialog" aria-modal="true" aria-labelledby="goal-create-title">
          <div className="goal-modal-head"><div><p className="goals-eyebrow">{nextGoal ? "KEEP GOING" : "MAKE IT COUNT"}</p><h2 id="goal-create-title">{nextGoal ? "What’s the next number?" : "Create a goal"}</h2></div><button type="button" onClick={() => setCreating(false)} aria-label="Close">×</button></div>
          <div className="goal-form">
            <label>Area<select value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value as GoalCategory })}>{AREAS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label>Goal name<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="Read Quran" /></label>
            <label>Type<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as CreateDraft["kind"] })}><option value="finite">Reach a target, then complete it</option><option value="ongoing">Keep doing it each day</option></select></label>
            {draft.kind === "finite" && <label>How progress is counted<select value={draft.measure} onChange={(event) => setDraft({ ...draft, measure: event.target.value as CreateDraft["measure"] })}><option value="sum">Add up progress</option><option value="latest">Use the latest number</option></select></label>}
            {draft.kind === "finite" && draft.measure === "latest" && <label>Starting number<input type="number" step="any" inputMode="decimal" value={draft.startValue} onChange={(event) => setDraft({ ...draft, startValue: event.target.value })} placeholder="Your current number" /></label>}
            <div className="goal-form-pair"><label>Target number<input type="number" min="0.01" step="any" inputMode="decimal" value={draft.target} onChange={(event) => setDraft({ ...draft, target: event.target.value })} placeholder="100" /></label><label>Unit<input value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} placeholder="pages" /></label></div>
            {draft.kind === "ongoing" && <label>Allowed misses each month<input type="number" min="0" max="31" step="1" inputMode="numeric" value={draft.allowedMisses} onChange={(event) => setDraft({ ...draft, allowedMisses: event.target.value })} /></label>}
            <button type="button" className="goal-create-submit" disabled={saving || !draft.title.trim() || !draft.target || !draft.unit.trim() || (draft.kind === "finite" && draft.measure === "latest" && !draft.startValue.trim())} onClick={createGoal}>{saving ? "Saving…" : "Create goal"}</button>
          </div>
        </section>
      </div>}
    </div>
  );
}
