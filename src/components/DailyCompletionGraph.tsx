"use client";

import { useCallback, useEffect, useState } from "react";
import type { DailyCompletion } from "@/core/daily-completion";
import "./daily-completion-graph.css";

type CompletionResponse = { ok: true; days: DailyCompletion[] } | { ok: false; error?: string };

function shortDay(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short" });
}

function fullDay(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
}

export function DailyCompletionGraph({ previewData }: { previewData?: { days: DailyCompletion[]; today: string } }) {
  const [days, setDays] = useState<DailyCompletion[]>(previewData?.days ?? []);
  const [selected, setSelected] = useState(previewData?.today ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(!previewData);

  const load = useCallback(async () => {
    if (previewData) return;
    try {
      const response = await fetch("/api/completion", { cache: "no-store" });
      const data = await response.json() as CompletionResponse;
      if (!response.ok || !data.ok) throw new Error(!data.ok ? data.error ?? "Could not load progress." : "Could not load progress.");
      setDays(data.days);
      setSelected((old) => old && data.days.some((day) => day.date === old) ? old : (data.days.at(-1)?.date ?? ""));
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load progress.");
    } finally { setLoading(false); }
  }, [previewData]);

  useEffect(() => {
    void load();
    if (previewData) return;
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("scheduler:tasks-changed", refresh);
    document.addEventListener("visibilitychange", refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("scheduler:tasks-changed", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.clearInterval(timer);
    };
  }, [load, previewData]);

  const current = days.find((day) => day.date === selected) ?? days.at(-1);
  const latest = days.at(-1);

  return (
    <section className="completion-card" aria-labelledby="completion-heading">
      <div className="completion-topline"><span>YOUR DAILY FOLLOW-THROUGH</span><span>LAST 14 DAYS</span></div>
      <div className="completion-hero">
        <div>
          <h2 id="completion-heading">The work, day by day.</h2>
          <p>Of the tasks assigned to each day, how many got done.</p>
        </div>
        <div className="completion-today" aria-label={latest?.percent === null ? "No tasks assigned today" : `${latest?.percent ?? 0} percent completed today`}>
          <strong>{latest?.percent === null || !latest ? "—" : `${latest.percent}%`}</strong>
          <span>TODAY</span>
        </div>
      </div>

      {loading ? <p className="completion-state">Loading your daily progress…</p> : error ? (
        <p className="completion-state" role="alert">{error}</p>
      ) : (
        <>
          <div className="completion-chart" role="group" aria-label="Daily completion graph">
            <div className="completion-guide"><span>100%</span><i /><span>50%</span><i /><span>0%</span></div>
            <div className="completion-bars">
              {days.map((day, index) => (
                <button key={day.date} type="button" className={`completion-day ${selected === day.date ? "is-selected" : ""}`}
                  onClick={() => setSelected(day.date)}
                  aria-label={`${fullDay(day.date)}: ${day.percent === null ? "no tasks assigned" : `${day.percent}% completed, ${day.completed} of ${day.assigned} tasks`}${day.moved ? `, ${day.moved} moved` : ""}`}
                  aria-pressed={selected === day.date}>
                  <span className="completion-track"><span className={`completion-fill ${day.percent === null ? "is-empty" : ""}`}
                    style={{ height: day.percent === null ? "3px" : `${Math.max(day.percent, 3)}%` }} /></span>
                  <span className="completion-day-label">{index % 2 === 0 || index === days.length - 1 ? shortDay(day.date)[0] : ""}</span>
                </button>
              ))}
            </div>
          </div>
          {current && <div className="completion-detail">
            <div><strong>{fullDay(current.date)}</strong><span>{current.percent === null ? "No tasks assigned" : `${current.completed} of ${current.assigned} completed`}</span></div>
            <div className="completion-detail-right"><strong>{current.percent === null ? "—" : `${current.percent}%`}</strong>{current.moved > 0 && <span>{current.moved} moved</span>}</div>
          </div>}
        </>
      )}
    </section>
  );
}
