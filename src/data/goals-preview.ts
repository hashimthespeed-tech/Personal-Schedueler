import type { GoalView } from "@/components/GoalsDashboard";

const calorieDays = [2840, 2910, 2810, 3020, 2860, 2770, 2950, 2890, 3110, 2820, 2990, 2860, 2920, 2810, 3010, 2870];
const caloriePoints = calorieDays.map((value, index) => ({ date: `2026-09-${String(index + 1).padStart(2, "0")}`, value, met: value >= 2800 }));
const schoolPoints = Array.from({ length: 17 }, (_, index) => ({
  date: `2026-09-${String(index + 1).padStart(2, "0")}`, value: index === 8 ? 0 : 1, met: index !== 8,
}));

/** Development-only sample data for visual review without a live database. */
export const goalPreview: { today: string; goals: GoalView[] } = {
  today: "2026-09-21",
  goals: [
    { id: 1, category: "fitness", title: "Daily calorie intake", kind: "ongoing", measure: "daily-number",
      target: 2800, comparison: "at-least", unit: "cal", allowedMisses: 2, createdOn: "2026-09-01",
      progress: { metDays: 15, missedDays: 1, unloggedDays: 5, livesRemaining: 1, completed: false, points: caloriePoints } },
    { id: 2, category: "fitness", title: "Reach target weight", kind: "finite", measure: "latest",
      target: 145, startValue: 130, comparison: "at-least", unit: "lb", createdOn: "2026-09-01",
      progress: { value: 140, progress: 2 / 3, reached: false,
        points: [{ date: "2026-09-01", value: 130 }, { date: "2026-09-08", value: 134 },
          { date: "2026-09-15", value: 137 }, { date: "2026-09-21", value: 140 }] } },
    { id: 3, category: "religion", title: "Read 100 pages of Quran", kind: "finite", measure: "sum",
      target: 100, comparison: "at-least", unit: "pages", createdOn: "2026-09-01",
      progress: { value: 68, progress: .68, reached: false,
        points: [{ date: "2026-09-03", value: 12 }, { date: "2026-09-10", value: 35 },
          { date: "2026-09-17", value: 55 }, { date: "2026-09-21", value: 68 }] } },
    { id: 4, category: "school", title: "Finish AP work on time", kind: "ongoing", measure: "daily-check",
      target: 1, comparison: "at-least", unit: "day", allowedMisses: 2, createdOn: "2026-09-01",
      progress: { metDays: 16, missedDays: 1, unloggedDays: 4, livesRemaining: 1, completed: false, points: schoolPoints } },
    { id: 5, category: "ai", title: "Ship 3 AI projects", kind: "finite", measure: "sum",
      target: 3, comparison: "at-least", unit: "projects", createdOn: "2026-09-01",
      progress: { value: 1, progress: 1 / 3, reached: false, points: [{ date: "2026-09-13", value: 1 }] } },
    { id: 6, category: "money", title: "Earn from my work", kind: "finite", measure: "sum",
      target: 500, comparison: "at-least", unit: "$", createdOn: "2026-09-01",
      progress: { value: 120, progress: .24, reached: false, points: [{ date: "2026-09-12", value: 50 }, { date: "2026-09-19", value: 120 }] } },
    { id: 7, category: "religion", title: "Complete first study book", kind: "finite", measure: "sum",
      target: 12, comparison: "at-least", unit: "chapters", createdOn: "2026-07-01", completedOn: "2026-08-30",
      progress: { value: 12, progress: 1, reached: true, points: [{ date: "2026-08-01", value: 5 }, { date: "2026-08-30", value: 12 }] } },
  ],
};
