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
