/**
 * The day as one ordered list.
 *
 * Today was four stacked sections — prayer, schedule, goals, sleep — which
 * reads like a report rather than a day. It is one timeline now, and the three
 * kinds of item in it behave differently:
 *
 *   anchor  waking and sleeping. Times, not work. Completing one means saying
 *           when it actually happened, and neither counts toward anything.
 *   fixed   prayer, school, practice. Immovable. Prayer can be marked; a
 *           class cannot — it happens whether or not you tick it.
 *   task    what the solver placed. The only kind that is really work.
 *
 * Keeping them distinct matters because a day made entirely of tickable boxes
 * makes waking up look like an achievement and a lesson look optional.
 */

import type { IsoDate, MinuteOfDay } from "./types";
import { prayerBlocks, type PrayerConfig, LA_MESA } from "./prayer";
import { bedtimeFor, type SleepModel, DEFAULT_SLEEP } from "./sleep";
import { fixedCommitmentsFor } from "../data/school";

export type TimelineKind = "anchor" | "fixed" | "task";

export interface TimelineItem {
  id: string;
  kind: TimelineKind;
  label: string;
  /** a single time for anchors and prayer; a range for everything else */
  start: MinuteOfDay;
  end?: MinuteOfDay;
  /** domain colour, for tasks only */
  domain?: string;
  /** whether ticking it means anything */
  completable: boolean;
  /** prayer block name, school period, etc. */
  ref?: string;
  detail?: string;
}

export interface TimelineInput {
  date: IsoDate;
  weekday: number;
  blocks: {
    id: number;
    title: string;
    domain: string;
    startMin: number;
    endMin: number;
    completed: boolean | null;
    chunkIndex: number | null;
    chunkCount: number | null;
  }[];
  sleep?: SleepModel;
  prayer?: PrayerConfig;
  /** true once the school term has ended or on a weekend */
  includeSchool?: boolean;
}

export function buildTimeline(input: TimelineInput): TimelineItem[] {
  const sleep = input.sleep ?? DEFAULT_SLEEP;
  const prayerConfig = input.prayer ?? LA_MESA;
  const items: TimelineItem[] = [];

  const prayers = prayerBlocks(input.date, prayerConfig);
  const fajr = prayers.find((p) => p.name === "fajr");

  // Fajr comes before waking: he prays, then goes back to sleep. Showing the
  // wake anchor first would put the day in the wrong order.
  if (fajr) {
    items.push({
      id: "prayer-fajr",
      kind: "fixed",
      label: "Fajr",
      start: fajr.start,
      completable: true,
      ref: "fajr",
      detail: `until ${fajr.window.end}`,
    });
  }

  items.push({
    id: "anchor-wake",
    kind: "anchor",
    label: "Wake up",
    start: sleep.dayStart,
    completable: true,
    ref: "wake",
  });

  if (input.includeSchool !== false) {
    for (const c of fixedCommitmentsFor(input.weekday)) {
      if (c.kind === "commute" || c.kind === "other") continue;
      items.push({
        id: `fixed-${c.id}`,
        kind: "fixed",
        label: c.title,
        start: c.start,
        end: c.end,
        // a class happens whether or not you tick it
        completable: false,
        ref: c.kind,
      });
    }
  }

  for (const p of prayers) {
    if (p.name === "fajr") continue;
    items.push({
      id: `prayer-${p.name}`,
      kind: "fixed",
      label: p.label,
      start: p.start,
      completable: true,
      ref: p.name,
    });
  }

  for (const b of input.blocks) {
    const chunk = b.chunkCount && b.chunkCount > 1 ? ` (${b.chunkIndex}/${b.chunkCount})` : "";
    items.push({
      id: `block-${b.id}`,
      kind: "task",
      label: `${b.title}${chunk}`,
      start: b.startMin,
      end: b.endMin,
      domain: b.domain,
      completable: true,
      ref: String(b.id),
    });
  }

  items.push({
    id: "anchor-sleep",
    kind: "anchor",
    label: "Sleep",
    start: bedtimeFor(input.date, sleep),
    completable: true,
    ref: "sleep",
  });

  return items.sort((a, b) => a.start - b.start || rank(a.kind) - rank(b.kind));
}

/** Ties break toward structure: an anchor, then what is fixed, then work. */
function rank(kind: TimelineKind): number {
  return kind === "anchor" ? 0 : kind === "fixed" ? 1 : 2;
}

/**
 * Net sleep from a reported bedtime and wake time, minus the Fajr wake.
 *
 * Bedtime is the evening before, so the span crosses midnight in the normal
 * case and the wrap has to be explicit.
 */
export function netSleepFrom(
  bedtimeMin: MinuteOfDay,
  wakeMin: MinuteOfDay,
  fajrInterruptionMin: number,
): number {
  const span = bedtimeMin > wakeMin ? 1440 - bedtimeMin + wakeMin : wakeMin - bedtimeMin;
  return Math.max(0, span - fajrInterruptionMin);
}
