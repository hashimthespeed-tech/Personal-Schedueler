import { DateTime } from "luxon";
import { buildDayFrame } from "../core/day-frame";
import { planSchoolwork, recommendWorkdays, suggestWorkdays, type PlanningDay } from "../core/schoolwork";

const date = "2026-09-21";
const dueDate = "2026-09-25";
const days: PlanningDay[] = [];
for (let day = DateTime.fromISO(date); day < DateTime.fromISO(dueDate); day = day.plus({ days: 1 })) {
  const iso = day.toISODate()!;
  days.push({ template: buildDayFrame(iso, { sleepMode: "current" }), notBefore: iso === date ? 1000 : 450 });
}
const selectedDates = recommendWorkdays(days, dueDate, 120, "test");

export const schoolworkPreview = {
  date,
  courses: [
    { id: 1, code: "APUSH", name: "AP US History" },
    { id: 2, code: "SPAN5H", name: "Spanish 5 Honors" },
    { id: 3, code: "AIDEV", name: "AI Powered Development" },
    { id: 4, code: "APCALC", name: "AP Calculus AB" },
    { id: 5, code: "APLIT", name: "AP English Literature" },
  ],
  assignments: [
    { id: 17, title: "Spanish reading", kind: "reading", courseId: 2, dueDate: "2026-09-23", estimatedMin: 40,
      sessions: [{ id: 71, onDate: "2026-09-22", durationMin: 40, startMin: 1100, role: "study", status: "planned" }] },
  ],
  draft: { courseId: 4, title: "Calculus unit test", kind: "test" as const, estimatedMin: 120, dueDate },
  options: suggestWorkdays(days, dueDate),
  recommendedDates: selectedDates,
  plan: planSchoolwork({ id: "preview", title: "Calculus unit test", kind: "test", totalMin: 120, dueDate, selectedDates }, days),
};

const exactMinuteTotal = 7;
const exactMinuteDates = recommendWorkdays(days, dueDate, exactMinuteTotal, "test");
export const schoolworkExactMinutePreview = {
  ...schoolworkPreview,
  draft: { ...schoolworkPreview.draft, title: "Calculus quiz review", estimatedMin: exactMinuteTotal },
  recommendedDates: exactMinuteDates,
  plan: planSchoolwork({ id: "exact-minute-preview", title: "Calculus quiz review", kind: "test",
    totalMin: exactMinuteTotal, dueDate, selectedDates: exactMinuteDates }, days),
};

const pressureDueDate = "2026-09-23";
const pressureSelected = ["2026-09-22"];
const pressureDays = days.filter((day) => day.template.date < pressureDueDate);
export const schoolworkPressurePreview = {
  ...schoolworkPreview,
  draft: { ...schoolworkPreview.draft, title: "Calculus problem set", kind: "homework" as const,
    estimatedMin: 225, dueDate: pressureDueDate },
  options: suggestWorkdays(pressureDays, pressureDueDate),
  recommendedDates: pressureSelected,
  plan: planSchoolwork({ id: "pressure-preview", title: "Calculus problem set", kind: "assignment",
    totalMin: 225, dueDate: pressureDueDate, selectedDates: pressureSelected }, pressureDays),
};

const shortNoticeDueDate = "2026-09-22";
const shortNoticeDays = days.filter((day) => day.template.date < shortNoticeDueDate);
const shortNoticeTotal = 37;
const shortNoticeDates = recommendWorkdays(shortNoticeDays, shortNoticeDueDate, shortNoticeTotal, "short-test");
export const schoolworkShortNoticePreview = {
  ...schoolworkPreview,
  draft: { ...schoolworkPreview.draft, title: "APUSH short-notice test", kind: "short_test" as const,
    estimatedMin: shortNoticeTotal, dueDate: shortNoticeDueDate },
  options: suggestWorkdays(shortNoticeDays, shortNoticeDueDate),
  recommendedDates: shortNoticeDates,
  plan: planSchoolwork({ id: "short-notice-preview", title: "APUSH short-notice test", kind: "short-test",
    totalMin: shortNoticeTotal, dueDate: shortNoticeDueDate, selectedDates: shortNoticeDates }, shortNoticeDays),
};

const lateDate = "2026-09-22";
const lateDueDate = "2026-09-23";
const lateNotBefore = 23 * 60;
const lateDays: PlanningDay[] = [{
  template: buildDayFrame(lateDate, { sleepMode: "current", includeRoutineTradeoffs: true }),
  notBefore: lateNotBefore,
}];
const lateSelected = [lateDate];
export const schoolworkLatePreview = {
  ...schoolworkPreview,
  date: lateDate,
  draft: { ...schoolworkPreview.draft, title: "APUSH reading due tomorrow", kind: "reading" as const,
    estimatedMin: 60, dueDate: lateDueDate },
  options: suggestWorkdays(lateDays, lateDueDate),
  recommendedDates: lateSelected,
  plan: planSchoolwork({ id: "late-preview", title: "APUSH reading due tomorrow", kind: "assignment",
    totalMin: 60, dueDate: lateDueDate, selectedDates: lateSelected }, lateDays),
  notBefore: lateNotBefore,
};

const ninePmNotBefore = 21 * 60;
const ninePmDays: PlanningDay[] = [{
  template: buildDayFrame(lateDate, { sleepMode: "current", includeRoutineTradeoffs: true }),
  notBefore: ninePmNotBefore,
}];
export const schoolworkNinePmPreview = {
  ...schoolworkLatePreview,
  draft: { ...schoolworkLatePreview.draft, estimatedMin: 90 },
  options: suggestWorkdays(ninePmDays, lateDueDate),
  plan: planSchoolwork({ id: "nine-pm-preview", title: "APUSH reading due tomorrow", kind: "assignment",
    totalMin: 90, dueDate: lateDueDate, selectedDates: lateSelected }, ninePmDays),
  notBefore: ninePmNotBefore,
};
