import { scoreRange, type AssignedTask } from "../core/daily-completion";

const today = "2026-09-21";
const tasks: AssignedTask[] = [];
const daily: [number, number][] = [
  [3, 4], [4, 5], [0, 0], [2, 3], [5, 5], [3, 4], [1, 2],
  [4, 4], [3, 5], [0, 0], [2, 2], [4, 5], [3, 3], [2, 4],
];
for (let index = 0; index < daily.length; index++) {
  const date = new Date(Date.UTC(2026, 8, 8 + index)).toISOString().slice(0, 10);
  const [done, assigned] = daily[index]!;
  for (let task = 0; task < assigned; task++) {
    tasks.push({ id: `${index}-${task}`, date, title: `Task ${task + 1}`,
      status: task < done ? "done" : "planned" });
  }
}
tasks.push({ id: "moved-preview", date: today, title: "History review", status: "moved" });

export const completionPreview = { days: scoreRange("2026-09-08", today, tasks), today };
