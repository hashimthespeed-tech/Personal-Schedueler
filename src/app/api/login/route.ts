import { NextResponse } from "next/server";
import { getSession, passphraseMatches } from "@/lib/auth";

export async function POST(request: Request) {
  const body = (await request.json()) as { passphrase?: unknown };
  if (typeof body.passphrase !== "string" || !passphraseMatches(body.passphrase)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const session = await getSession();
  session.loggedIn = true;
  await session.save();
  return NextResponse.json({ ok: true });
}
