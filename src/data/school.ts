/**
 * Grossmont High School — Term S1, 08/12/2026 to 12/17/2026.
 *
 * Two bell schedules: REG (Mon-Thu) and FRI (late start).
 *
 * Period 7 is a free period the user spends on campus and can work through.
 * It is marked `workable`, which makes it the only fixed commitment the routine
 * puts work inside — and only schoolwork, since he is at school and has
 * neither weights nor a private space.
 */

import type { FixedCommitment, MinuteOfDay } from "../core/types";
import { hm } from "../core/types";

export const TERM_S1 = { start: "2026-08-12", end: "2026-12-17" } as const;

export interface Course {
  period: number;
  code: string;
  name: string;
  teacher: string;
  room: string;
  /** AP and honors courses carry heavier out-of-class load */
  rigor: "ap" | "honors" | "standard" | "pe" | "free";
  /** which goal domain homework for this course counts toward */
  domain: "school" | "ai" | "physique";
  /** typical minutes of homework per class meeting, used to seed the Tutor */
  baselineHomeworkMin: number;
}

export const COURSES: Course[] = [
  { period: 1, code: "APUSH", name: "AP US History 1", teacher: "Williams, Nicole A", room: "830", rigor: "ap", domain: "school", baselineHomeworkMin: 45 },
  { period: 2, code: "SPAN5H", name: "Spanish 5 Honors", teacher: "Velarde, Melissa", room: "1412", rigor: "honors", domain: "school", baselineHomeworkMin: 30 },
  { period: 3, code: "AIDEV", name: "AI Powered Dev 1C", teacher: "Benrud, Todd Alan", room: "540", rigor: "standard", domain: "ai", baselineHomeworkMin: 30 },
  { period: 4, code: "APCALC", name: "AP Calculus AB", teacher: "King, Emilie", room: "780", rigor: "ap", domain: "school", baselineHomeworkMin: 45 },
  { period: 5, code: "APLIT", name: "AP English Literature", teacher: "Chestnut, Mary K", room: "1466", rigor: "ap", domain: "school", baselineHomeworkMin: 45 },
  { period: 6, code: "TEAMSP", name: "Team Sports", teacher: "Taylor, Rebecca", room: "GYM", rigor: "pe", domain: "physique", baselineHomeworkMin: 0 },
  { period: 7, code: "FREE", name: "Free Period", teacher: "Froumis, Brianne N", room: "-", rigor: "free", domain: "school", baselineHomeworkMin: 0 },
];

interface BellPeriod {
  period: number;
  start: MinuteOfDay;
  end: MinuteOfDay;
}

/** Mon-Thu. Verified against the user's published schedule. */
export const BELL_REG: BellPeriod[] = [
  { period: 1, start: hm("08:30"), end: hm("09:20") },
  { period: 2, start: hm("09:26"), end: hm("10:16") },
  { period: 3, start: hm("10:30"), end: hm("11:20") },
  { period: 4, start: hm("11:26"), end: hm("12:18") },
  { period: 5, start: hm("12:54"), end: hm("13:44") },
  { period: 6, start: hm("13:50"), end: hm("14:40") },
  { period: 7, start: hm("14:46"), end: hm("15:36") },
];

/** Friday late start. Verified against the user's published schedule. */
export const BELL_FRI: BellPeriod[] = [
  { period: 1, start: hm("09:00"), end: hm("09:42") },
  { period: 2, start: hm("09:48"), end: hm("10:30") },
  { period: 3, start: hm("11:04"), end: hm("11:46") },
  { period: 4, start: hm("11:52"), end: hm("12:36") },
  { period: 5, start: hm("13:12"), end: hm("13:54") },
  { period: 6, start: hm("14:00"), end: hm("14:42") },
  { period: 7, start: hm("14:48"), end: hm("15:30") },
];

/** Lunch is the gap between periods 4 and 5 on both bell schedules. */
const LUNCH_AFTER_PERIOD = 4;

/** Door-to-door each way. 08:05 departure for an 08:30 bell. */
export const COMMUTE_MIN = 25;
export const COMMUTE_HOME_MIN = 19;

/** Tue and Thu. Home at 17:30. */
export const PRACTICE_DAYS = [2, 4];
export const PRACTICE_HOME_TIME = hm("17:30");

function courseFor(period: number): Course {
  const c = COURSES.find((x) => x.period === period);
  if (!c) throw new Error(`No course for period ${period}`);
  return c;
}

/**
 * Every fixed commitment for one weekday (1 = Mon .. 7 = Sun).
 * Weekends return an empty list — nothing is fixed.
 */
export function fixedCommitmentsFor(weekday: number): FixedCommitment[] {
  if (weekday > 5) return [];

  const bell = weekday === 5 ? BELL_FRI : BELL_REG;
  const first = bell[0];
  const last = bell[bell.length - 1];
  if (!first || !last) throw new Error("Empty bell schedule");

  const out: FixedCommitment[] = [];

  out.push({
    id: `${weekday}-commute-am`,
    title: "Commute to school",
    weekday,
    start: first.start - COMMUTE_MIN,
    end: first.start,
    kind: "commute",
    offSite: true,
  });

  for (const p of bell) {
    const course = courseFor(p.period);
    out.push({
      id: `${weekday}-p${p.period}`,
      title: `P${p.period} ${course.name}`,
      weekday,
      start: p.start,
      end: p.end,
      kind: "school",
      offSite: true,
      // the free period is the one fixed commitment that is usable time
      workable: course.rigor === "free",
    });
  }

  // Everything between two periods is accounted for. Gaps are derived from the
  // bells rather than hardcoded, so the two bell schedules cannot drift out of
  // sync with a second copy of lunch. None of it is workable: passing periods
  // are short, and the Friday break between periods 2 and 3 has not been
  // confirmed as usable time.
  for (let i = 0; i < bell.length - 1; i++) {
    const current = bell[i];
    const next = bell[i + 1];
    if (!current || !next) continue;
    if (next.start <= current.end) continue;

    const isLunch = current.period === LUNCH_AFTER_PERIOD;
    out.push({
      id: `${weekday}-gap-${current.period}`,
      title: isLunch ? "Lunch" : "Break",
      weekday,
      start: current.end,
      end: next.start,
      kind: isLunch ? "meal" : "other",
      offSite: true,
    });
  }

  if (PRACTICE_DAYS.includes(weekday)) {
    out.push({
      id: `${weekday}-practice`,
      title: "Practice",
      weekday,
      start: last.end,
      end: PRACTICE_HOME_TIME,
      kind: "practice",
      offSite: true,
    });
  } else {
    out.push({
      id: `${weekday}-commute-pm`,
      title: "Commute home",
      weekday,
      start: last.end,
      end: last.end + COMMUTE_HOME_MIN,
      kind: "commute",
      offSite: true,
    });
  }

  return out.sort((a, b) => a.start - b.start);
}

/** The lunch window for a weekday, derived from the bell schedule. */
export function lunchFor(weekday: number): { start: MinuteOfDay; end: MinuteOfDay } | null {
  if (weekday > 5) return null;
  const bell = weekday === 5 ? BELL_FRI : BELL_REG;
  const idx = bell.findIndex((p) => p.period === LUNCH_AFTER_PERIOD);
  const current = bell[idx];
  const next = bell[idx + 1];
  if (!current || !next) return null;
  return { start: current.end, end: next.start };
}

/** The time the user is actually home and free, per weekday. */
export function homeTimeFor(weekday: number): MinuteOfDay | null {
  if (weekday > 5) return null;
  if (PRACTICE_DAYS.includes(weekday)) return PRACTICE_HOME_TIME;
  const bell = weekday === 5 ? BELL_FRI : BELL_REG;
  const last = bell[bell.length - 1];
  if (!last) throw new Error("Empty bell schedule");
  return last.end + COMMUTE_HOME_MIN;
}
