import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/index";
import { checkIns } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { netSleepFrom } from "@/core/sleep";

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

  // One wake. He prays Fajr when he gets up at 06:00, inside its window all
  // school year, so the night is simply bedtime to wake with nothing deducted.
  const sleepMin = netSleepFrom(bedtimeMin, wakeMin);

  await db
    .insert(checkIns)
    .values({ onDate, bedtimeMin, wakeMin, sleepMin })
    .onConflictDoUpdate({
      target: checkIns.onDate,
      set: { bedtimeMin, wakeMin, sleepMin },
    });

  return NextResponse.json({ ok: true, sleepMin });
}
