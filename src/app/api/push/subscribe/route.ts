import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db/index";
import { pushSubscriptions } from "@/db/schema";
import { getSession } from "@/lib/auth";

const body = z.object({
  endpoint: z.string().url(),
  keys: z.object({ p256dh: z.string(), auth: z.string() }),
});

export async function POST(request: Request) {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const parsed = body.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ ok: false }, { status: 400 });

  await db
    .insert(pushSubscriptions)
    .values({
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
    })
    .onConflictDoNothing({ target: pushSubscriptions.endpoint });

  return NextResponse.json({ ok: true });
}
