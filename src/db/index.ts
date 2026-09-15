import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Lazy. A module-level connection would make `next build` require a live
 * DATABASE_URL, which it should not — the pages are all dynamic and nothing
 * queries at build time.
 */
let cached: PostgresJsDatabase<typeof schema> | null = null;

function connect(): PostgresJsDatabase<typeof schema> {
  if (cached) return cached;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env locally, or to your host's environment variables when deployed. Neon's free tier works.",
    );
  }

  cached = drizzle(postgres(url, { max: 1 }), { schema });
  return cached;
}

/** Behaves like the drizzle client, but does not connect until first use. */
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_target, property, receiver) {
    return Reflect.get(connect(), property, receiver);
  },
});

export { schema };
