import "dotenv/config";
import type { Config } from "drizzle-kit";

/**
 * `import "dotenv/config"` is load-bearing. drizzle-kit does not read .env on
 * its own, and without it `db:push` connects with an empty URL, prints
 * "Pulling schema from database…", then exits 0 having done nothing — no
 * error, no tables. The seed that follows fails on a table that was never
 * created, which points at entirely the wrong problem.
 */
const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL is not set.\n\n" +
      "Create a .env file in the project root containing:\n" +
      "  DATABASE_URL=postgresql://user:password@host/dbname\n\n" +
      "Copy .env.example to .env and fill it in. Neon's free tier works.",
  );
}

export default {
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
} satisfies Config;
