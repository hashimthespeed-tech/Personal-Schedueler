import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/index";
import { prayerLog } from "@/db/schema";
import { getSession } from "@/lib/auth";

const body = z.object({
  onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  block: z.enum(["fajr", "dhuhr-asr", "maghrib-isha"]),
  status: z.enum(["on-time", "late", "missed"]).nullable(),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  const { onDate, block, status } = parsed.data;

  // null clears it, so a mis-tap is undoable
  if (status === null) {
    await db.delete(prayerLog).where(and(eq(prayerLog.onDate, onDate), eq(prayerLog.block, block)));
    return NextResponse.json({ ok: true, status: null });
  }

  await db
    .insert(prayerLog)
    .values({ onDate, block, status })
    .onConflictDoUpdate({
      target: [prayerLog.onDate, prayerLog.block],
      set: { status },
    });

  return NextResponse.json({ ok: true, status });
}
