/**
 * Volume gating.
 *
 * The user's training plan closes with: "Eating. You're underfed. Training
 * without fixing this does almost nothing." That belongs in code, not in a
 * paragraph at the bottom of a document nobody rereads.
 *
 * The Coach can see bodyweight and sleep because everything writes to one
 * shared store. It refuses to add load to a body that is not being fed or
 * rested — which is the entire argument for a hub over four separate chatbots.
 */

export interface GateInputs {
  /** most recent bodyweights, oldest first, at least 7 days of span */
  recentWeights: { date: string; lb: number }[];
  /** net sleep minutes per night over the same window */
  recentNetSleepMin: number[];
  targetSleepMin: number;
}

export type GateVerdict = "progress" | "hold" | "hold-and-escalate";

export interface GateResult {
  verdict: GateVerdict;
  allowProgression: boolean;
  /** shown to the user as the reason, verbatim */
  reason: string;
  bodyweightTrendLbPerWeek: number | null;
  avgNetSleepMin: number | null;
}

/** Least-squares slope in lb/week over the supplied samples. */
export function bodyweightTrend(samples: { date: string; lb: number }[]): number | null {
  if (samples.length < 3) return null;

  const t0 = Date.parse(samples[0]?.date ?? "");
  if (Number.isNaN(t0)) return null;

  const points = samples.map((s) => ({
    x: (Date.parse(s.date) - t0) / (1000 * 60 * 60 * 24),
    y: s.lb,
  }));

  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumXX = points.reduce((a, p) => a + p.x * p.x, 0);

  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;

  const slopePerDay = (n * sumXY - sumX * sumY) / denom;
  return slopePerDay * 7;
}

export function evaluateGate(input: GateInputs): GateResult {
  const trend = bodyweightTrend(input.recentWeights);
  const avgSleep =
    input.recentNetSleepMin.length > 0
      ? input.recentNetSleepMin.reduce((a, b) => a + b, 0) / input.recentNetSleepMin.length
      : null;

  const sleepShort = avgSleep !== null && avgSleep < input.targetSleepMin;
  const notGaining = trend !== null && trend <= 0;

  if (notGaining) {
    return {
      verdict: "hold-and-escalate",
      allowProgression: false,
      reason:
        trend === null
          ? "not enough weigh-ins to tell"
          : `scale is ${trend < 0 ? "down" : "flat"} at ${trend.toFixed(1)} lb/week — eat more before adding load`,
      bodyweightTrendLbPerWeek: trend,
      avgNetSleepMin: avgSleep,
    };
  }

  if (sleepShort && avgSleep !== null) {
    const shortBy = Math.round((input.targetSleepMin - avgSleep) / 6) / 10;
    return {
      verdict: "hold",
      allowProgression: false,
      reason: `averaging ${shortBy}h under your sleep target — load holds until that closes`,
      bodyweightTrendLbPerWeek: trend,
      avgNetSleepMin: avgSleep,
    };
  }

  return {
    verdict: "progress",
    allowProgression: true,
    reason:
      trend !== null
        ? `gaining ${trend.toFixed(1)} lb/week and sleeping enough — progress as normal`
        : "progress as normal",
    bodyweightTrendLbPerWeek: trend,
    avgNetSleepMin: avgSleep,
  };
}
