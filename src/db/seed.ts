/**
 * Seeds the real schedule and profile. Idempotent — safe to re-run.
 *
 * Run with: npm run db:seed
 */

import "dotenv/config";
import { db } from "./index";
import { courses, fixedCommitments, goals, settings } from "./schema";
import { COURSES, TERM_S1, BELL_REG, BELL_FRI, fixedCommitmentsFor } from "../data/school";
import { DEFAULT_SLEEP } from "../core/sleep";
import { LA_MESA } from "../core/prayer";
import { ANKLE_RESTRICTIONS } from "../coach/program";

async function main() {
  console.log("Seeding…");

  // A missing table almost always means db:push never ran — or ran against an
  // empty DATABASE_URL and exited quietly. Say that, rather than surfacing a
  // failed DELETE and letting it look like a data problem.
  try {
    await db.select().from(courses).limit(1);
  } catch {
    throw new Error(
      "The tables do not exist yet.\n\n" +
        "Run this first:\n  npm run db:push\n\n" +
        "It should finish with \"Changes applied\". If it stops at \"Pulling schema\n" +
        "from database…\" and returns to the prompt, DATABASE_URL is not set — check .env.",
    );
  }

  await db.delete(courses);
  await db.insert(courses).values(
    COURSES.map((c) => ({
      code: c.code,
      name: c.name,
      teacher: c.teacher,
      room: c.room,
      period: c.period,
      rigor: c.rigor,
      domain: c.domain,
      baselineHomeworkMin: c.baselineHomeworkMin,
      termStart: TERM_S1.start,
      termEnd: TERM_S1.end,
    })),
  );
  console.log(`  ${COURSES.length} courses (${BELL_REG.length} periods, Friday late start)`);

  await db.delete(fixedCommitments);
  const commitments = [1, 2, 3, 4, 5].flatMap((weekday) =>
    fixedCommitmentsFor(weekday).map((c) => ({
      title: c.title,
      weekday: c.weekday,
      onDate: null,
      startMin: c.start,
      endMin: c.end,
      kind: c.kind,
      offSite: c.offSite ?? false,
      workable: c.workable ?? false,
    })),
  );
  await db.insert(fixedCommitments).values(commitments);
  console.log(`  ${commitments.length} fixed commitments across the school week`);

  await db.delete(settings);
  await db.insert(settings).values({
    id: 1,
    latitude: LA_MESA.latitude,
    longitude: LA_MESA.longitude,
    timezone: LA_MESA.timezone,
    dayStartMin: DEFAULT_SLEEP.dayStart,
    fajrInterruptionMin: DEFAULT_SLEEP.fajrInterruptionMin,
    targetSleepMin: DEFAULT_SLEEP.targetSleepMin,
    startBedtimeMin: DEFAULT_SLEEP.startBedtime,
    goalBedtimeMin: DEFAULT_SLEEP.goalBedtime,
    rampMinutesPerWeek: DEFAULT_SLEEP.rampMinutesPerWeek,
    rampStartDate: DEFAULT_SLEEP.rampStartDate,
        wrestlingPhase: "preseason",
    restrictions: [...ANKLE_RESTRICTIONS],
    heightIn: 67.5,
    bodyweightGoalLb: 145,
    calorieTarget: 2900,
    proteinTargetG: 120,
  });
  console.log("  settings: La Mesa, Jafari, 06:00 wake, 23:00→21:40 bedtime ramp, preseason");

  const existingGoals = await db.select().from(goals);
  if (existingGoals.length === 0) {
    await db.insert(goals).values([
      { domain: "school", northStar: "Finish junior year with the AP grades I want", currentFocus: "Stay ahead of APUSH and Calc rather than catching up" },
      { domain: "deen", northStar: "Pray all three blocks on time, every day", currentFocus: "Fajr without going back to sleep past 6" },
      { domain: "physique", northStar: "Add 15-20 lb of muscle", currentFocus: "Eat enough to actually gain — training is not the limiter yet" },
      { domain: "ai", northStar: "Build and ship AI projects", currentFocus: "Use the morning block before school" },
      { domain: "money", northStar: "Make money with what I build", currentFocus: "Find one thing someone would pay for" },
    ]);
    console.log("  5 starter goals (edit them in the app)");
  } else {
    console.log(`  ${existingGoals.length} goals already present — left alone`);
  }

  console.log("\nDone. Friday bells:", BELL_FRI.map((p) => `P${p.period}`).join(" "));
  process.exit(0);
}

main().catch((error) => {
  console.error("\nSeed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
