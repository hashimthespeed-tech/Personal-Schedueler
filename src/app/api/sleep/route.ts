import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/index";
import { checkIns, prayerLog, settings } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { netSleepFrom } from "@/core/sleep";
import { fajrInterruptionFor } from "@/core/sleep";

const body = z.object({
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** minutes since midnight, the evening before */
  bedtimeMin: z.number().int().min(0).max(1439),
  wakeMin: z.number().int().min(0).max(1439),
});

/**
 * Sleep is reported the morning after, keyed to the day he woke up.
 *
 * Asking at bedtime asks him to predict; asking the next morning asks him to
 * remember, which is the only one of the two he can actually do.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const { onDate, bedtimeMin, wakeMin } = parsed.data;

  // only charge the Fajr wake if he actually marked it
  const prayed = await db
    .select()
    .from(prayerLog)
    .where(and(eq(prayerLog.onDate, onDate), eq(prayerLog.block, "fajr")))
    .limit(1);
  const status = prayed[0]?.status;
  const prayedFajr = status === "on-time" || status === "late";

  const row = (await db.select().from(settings).limit(1))[0];
  const interruption = row ? fajrInterruptionFor(onDate, prayedFajr) : 0;
  const sleepMin = netSleepFrom(bedtimeMin, wakeMin);

  await db
    .insert(checkIns)
    .values({ onDate, bedtimeMin, wakeMin, sleepMin })
    .onConflictDoUpdate({
      target: checkIns.onDate,
      set: { bedtimeMin, wakeMin, sleepMin },
    });

  return NextResponse.json({ ok: true, sleepMin, interruption });
}
