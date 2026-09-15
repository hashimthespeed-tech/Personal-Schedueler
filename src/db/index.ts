import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and point it at a Postgres database (Neon's free tier works).",
  );
}

const client = postgres(url, { max: 1 });

export const db = drizzle(client, { schema });
export { schema };
