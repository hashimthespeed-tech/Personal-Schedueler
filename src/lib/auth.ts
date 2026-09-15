/**
 * Single-user auth. A passphrase and a signed cookie — no provider, no user
 * table, because there is exactly one user and there always will be.
 */

import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export interface SessionData {
  loggedIn?: boolean;
}

function options(): SessionOptions {
  const password = process.env.SESSION_PASSWORD;
  if (!password || password.length < 32) {
    throw new Error("SESSION_PASSWORD must be set and at least 32 characters.");
  }
  return {
    password,
    cookieName: "scheduler_session",
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    },
  };
}

export async function getSession(): Promise<IronSession<SessionData>> {
  const store = await cookies();
  return getIronSession<SessionData>(store, options());
}

export async function requireSession(): Promise<void> {
  const session = await getSession();
  if (!session.loggedIn) redirect("/login");
}

/** Constant-time-ish comparison; the passphrase is low-value but free to do right. */
export function passphraseMatches(input: string): boolean {
  const expected = process.env.APP_PASSPHRASE;
  if (!expected) throw new Error("APP_PASSPHRASE is not set.");
  if (input.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < input.length; i++) {
    diff |= input.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}
