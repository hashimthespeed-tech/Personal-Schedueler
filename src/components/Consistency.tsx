import type { Cell, Consistency as Score, SlotScore } from "@/core/consistency";

/**
 * Two charts, both reading from the same window.
 *
 * The grid answers "did I do it" across every slot and every day at once — it
 * is the one picture that shows a pattern rather than a number, and a row that
 * is mostly empty on Thursdays tells you something no percentage does.
 *
 * The lines answer "how hard did I go", which only exists where he tapped a
 * number, so every series here is sparse by design and the chart has to look
 * right with gaps in it.
 *
 * Colour: the app's domain palette, validated against the data-viz checks in
 * both modes. Training is below 3:1 on the dark surface, so the relief rule
 * applies and every row carries a visible label and its own number — identity
 * is never colour alone here.
 */

const CELL = 13;
const GAP = 2;

function accentFor(domain: string | null): string {
  return domain ? `var(--color-${domain})` : "var(--dim)";
}

function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { day: "numeric" });
}

function weekdayLetter(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "narrow" });
}

/* ------------------------------------------------------------------ */

export function Grid({ score }: { score: Score }) {
  const rows = [...score.slots].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "core" ? -1 : 1;
    return b.rate - a.rate;
  });

  const byKey = new Map<string, Map<string, Cell>>();
  for (const cell of score.grid) {
    const row = byKey.get(cell.slotKey) ?? new Map<string, Cell>();
    row.set(cell.date, cell);
    byKey.set(cell.slotKey, row);
  }

  const width = score.dates.length * (CELL + GAP);

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs" style={{ color: "var(--dim)" }}>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--dim)" }} />
          done
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ border: "1.5px solid var(--color-physique)" }}
          />
          missed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: "var(--line)" }}
          />
          not answered
        </span>
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: `${width + 140}px` }}>
          {/* the date rule, thinned so it stays readable over 90 days */}
          <div className="mb-1 flex" style={{ paddingLeft: "140px" }}>
            {score.dates.map((date, i) => (
              <div
                key={date}
                className="shrink-0 text-center tabular-nums"
                style={{
                  width: `${CELL}px`,
                  marginRight: `${GAP}px`,
                  fontSize: "8px",
                  color: "var(--dim)",
                }}
              >
                {score.dates.length <= 14
                  ? weekdayLetter(date)
                  : i % 7 === 0
                    ? shortDate(date)
                    : ""}
              </div>
            ))}
          </div>

          {rows.map((slot) => {
            const row = byKey.get(slot.key);
            const accent = accentFor(slot.domain);
            return (
              <div key={slot.key} className="mb-0.5 flex items-center">
                <div
                  className="flex shrink-0 items-baseline gap-2 pr-3"
                  style={{ width: "140px" }}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: accent }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate text-xs">{slot.label}</span>
                  <span className="dim shrink-0 text-[10px] tabular-nums">
                    {Math.round(slot.rate * 100)}%
                  </span>
                </div>

                <div className="flex">
                  {score.dates.map((date) => {
                    const cell = row?.get(date);
                    const title = `${slot.label}, ${date}: ${
                      cell?.status === "done"
                        ? cell.intensity
                          ? `done, ${cell.intensity}/10`
                          : "done"
                        : cell?.status === "missed"
                          ? "missed"
                          : "not answered"
                    }`;

                    return (
                      <div
                        key={date}
                        title={title}
                        className="shrink-0 rounded-sm"
                        style={{
                          width: `${CELL}px`,
                          height: `${CELL}px`,
                          marginRight: `${GAP}px`,
                          background:
                            cell?.status === "done"
                              ? accent
                              : cell?.status === "missed"
                                ? "transparent"
                                : "var(--line)",
                          border:
                            cell?.status === "missed"
                              ? "1.5px solid var(--color-physique)"
                              : "1.5px solid transparent",
                          // rated days read darker; unrated stay at full accent
                          opacity:
                            cell?.status === "done" && cell.intensity
                              ? 0.45 + (cell.intensity / 10) * 0.55
                              : 1,
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <figcaption className="dim mt-3 text-xs leading-relaxed">
        Every tracked slot, every day. The four core hours come first, then prayer — each group
        sorted by how often you actually did it, so the one giving you trouble sits at the bottom
        of its group. Where you rated a session, the square is shaded by how hard you went.
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */

const CHART_W = 640;
const CHART_H = 190;
const PAD = { top: 12, right: 12, bottom: 22, left: 26 };

export function IntensityChart({ score }: { score: Score }) {
  const rated = score.slots.filter((s) => s.kind === "core" && s.avgIntensity !== null);
  if (rated.length === 0) return null;

  const byKey = new Map<string, Map<string, Cell>>();
  for (const cell of score.grid) {
    const row = byKey.get(cell.slotKey) ?? new Map<string, Cell>();
    row.set(cell.date, cell);
    byKey.set(cell.slotKey, row);
  }

  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const step = score.dates.length > 1 ? plotW / (score.dates.length - 1) : 0;

  const x = (i: number) => PAD.left + i * step;
  const y = (v: number) => PAD.top + plotH - ((v - 1) / 9) * plotH;

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs" style={{ color: "var(--dim)" }}>
        {rated.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5">
            <i
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: accentFor(s.domain) }}
            />
            {s.label}
            <b className="tabular-nums" style={{ fontWeight: 600, color: "var(--fg)" }}>
              {s.avgIntensity!.toFixed(1)}
            </b>
          </span>
        ))}
      </div>

      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          role="img"
          aria-label={`Intensity out of ten over ${score.days} days. ${rated
            .map((s) => `${s.label} averages ${s.avgIntensity!.toFixed(1)}`)
            .join(". ")}.`}
          style={{ display: "block", width: "100%", minWidth: "320px", height: "auto" }}
        >
          {[1, 4, 7, 10].map((v) => (
            <g key={v}>
              <line
                x1={PAD.left}
                y1={y(v)}
                x2={CHART_W - PAD.right}
                y2={y(v)}
                stroke="var(--line)"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 6}
                y={y(v) + 3}
                textAnchor="end"
                style={{ fontSize: "9px", fill: "var(--dim)" }}
              >
                {v}
              </text>
            </g>
          ))}

          {rated.map((slot) => {
            const row = byKey.get(slot.key);
            const points = score.dates
              .map((date, i) => ({ i, v: row?.get(date)?.intensity ?? null }))
              .filter((p): p is { i: number; v: number } => p.v !== null);

            if (points.length === 0) return null;
            const accent = accentFor(slot.domain);

            // sparse by design — join only consecutive rated days, so a gap
            // reads as a gap instead of a straight line through nothing
            const segments: { i: number; v: number }[][] = [];
            let run: { i: number; v: number }[] = [];
            for (const point of points) {
              const previous = run[run.length - 1];
              if (previous && point.i - previous.i > 1) {
                segments.push(run);
                run = [];
              }
              run.push(point);
            }
            if (run.length > 0) segments.push(run);

            return (
              <g key={slot.key}>
                {segments.map((segment, si) => (
                  <polyline
                    key={si}
                    fill="none"
                    stroke={accent}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={segment.map((p) => `${x(p.i)},${y(p.v)}`).join(" ")}
                  />
                ))}
                {points.map((p) => (
                  <circle
                    key={p.i}
                    cx={x(p.i)}
                    cy={y(p.v)}
                    r="3.5"
                    fill={accent}
                    stroke="var(--card)"
                    strokeWidth="2"
                  >
                    <title>{`${slot.label}, ${score.dates[p.i]}: ${p.v}/10`}</title>
                  </circle>
                ))}
              </g>
            );
          })}

          <text
            x={PAD.left}
            y={CHART_H - 5}
            style={{ fontSize: "9px", fill: "var(--dim)" }}
          >
            {score.from}
          </text>
          <text
            x={CHART_W - PAD.right}
            y={CHART_H - 5}
            textAnchor="end"
            style={{ fontSize: "9px", fill: "var(--dim)" }}
          >
            {score.to}
          </text>
        </svg>
      </div>

      <figcaption className="dim mt-2 text-xs leading-relaxed">
        Only the sessions you rated. Gaps are days you ticked without rating — the line stops
        rather than pretending to know.
      </figcaption>
    </figure>
  );
}

/* ------------------------------------------------------------------ */

export function SlotTable({ slots }: { slots: SlotScore[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: "340px" }}>
        <thead>
          <tr className="dim text-[11px] uppercase tracking-wide">
            <th className="py-2 pr-3 text-left font-medium">Slot</th>
            <th className="py-2 pr-3 text-right font-medium">Done</th>
            <th className="py-2 pr-3 text-right font-medium">Missed</th>
            <th className="py-2 pr-3 text-right font-medium">Skipped</th>
            <th className="py-2 text-right font-medium">Avg</th>
          </tr>
        </thead>
        <tbody>
          {slots.map((s) => (
            <tr key={s.key} style={{ borderTop: "1px solid var(--line)" }}>
              <td className="py-2 pr-3">
                <span className="inline-flex items-center gap-2">
                  <i
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: accentFor(s.domain) }}
                    aria-hidden="true"
                  />
                  {s.label}
                </span>
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">
                {s.done}/{s.scheduled}
              </td>
              <td className="py-2 pr-3 text-right tabular-nums">{s.missed}</td>
              <td className="dim py-2 pr-3 text-right tabular-nums">{s.silent}</td>
              <td className="py-2 text-right tabular-nums">
                {s.avgIntensity === null ? "—" : s.avgIntensity.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
