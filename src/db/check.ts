/**
 * Connection diagnostic.
 *
 * drizzle-kit swallows connection failures: it prints "Pulling schema from
 * database…", exits 0, and creates nothing. This says what actually went
 * wrong instead.
 *
 * Run with: npm run db:check
 */

import "dotenv/config";
import postgres from "postgres";

function mask(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return "(unparseable)";
  }
}

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

async function main() {
  const raw = process.env.DATABASE_URL;

  if (!raw) {
    fail(
      "DATABASE_URL is not set.\n\n" +
        "Create a .env file in the project root with:\n" +
        "  DATABASE_URL=postgresql://user:password@host/dbname?sslmode=require",
    );
  }

  console.log("Checking the database connection…\n");

  // Neon's dashboard offers a psql command, and it is easy to copy the whole
  // line rather than just the URL inside it.
  if (raw.startsWith("psql ")) {
    fail(
      "DATABASE_URL starts with 'psql '.\n\n" +
        "You copied the whole command. Keep only the URL inside the quotes —\n" +
        "the part beginning postgresql://",
    );
  }

  // The .env.example placeholder resolves to a hostname of literally "host",
  // which fails as a DNS error and reads like a typo rather than a line that
  // was never filled in.
  const PLACEHOLDERS = [
    "postgresql://user:password@host/dbname",
    "user:password@host",
    "@host/dbname",
  ];
  if (PLACEHOLDERS.some((p) => raw.includes(p))) {
    fail(
      "DATABASE_URL is still the example value from .env.example.\n\n" +
        `  ${mask(raw)}\n\n` +
        "Open .env and replace that whole line with your real connection string.\n" +
        "In Neon: your project -> Connection string -> copy. It looks like:\n\n" +
        "  postgresql://neondb_owner:PASSWORD@ep-something-12345678.us-west-2.aws.neon.tech/neondb?sslmode=require\n\n" +
        "Copy only the URL — not a surrounding psql '...' wrapper.",
    );
  }

  const trimmed = raw.trim().replace(/^['"]|['"]$/g, "");
  if (trimmed !== raw) {
    console.log("  note: stripped surrounding quotes or whitespace");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    fail(
      `DATABASE_URL is not a valid URL:\n  ${trimmed.slice(0, 40)}…\n\n` +
        "It should look like:\n" +
        "  postgresql://user:password@host.neon.tech/neondb?sslmode=require",
    );
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    fail(`DATABASE_URL starts with '${url.protocol}' — it must start with postgresql://`);
  }

  console.log(`  url      ${mask(trimmed)}`);
  console.log(`  host     ${url.hostname}`);
  console.log(`  database ${url.pathname.slice(1) || "(none!)"}`);
  console.log(`  ssl      ${url.searchParams.get("sslmode") ?? "(not specified)"}`);

  if (url.hostname.includes("neon.tech") && !url.searchParams.has("sslmode")) {
    console.log("\n  warning: Neon requires SSL. Add ?sslmode=require to the end of the URL.");
  }

  console.log("\nConnecting…");

  const sql = postgres(trimmed, { max: 1, connect_timeout: 15, idle_timeout: 5 });

  try {
    const rows = await sql`select current_database() as db, version() as version`;
    const row = rows[0];
    console.log(`\n  connected to "${row?.db}"`);
    console.log(`  ${String(row?.version).split(",")[0]}`);

    const tables = await sql<{ name: string }[]>`
      select table_name as name from information_schema.tables
      where table_schema = 'public' order by table_name
    `;

    if (tables.length === 0) {
      console.log("\n  No tables yet. Run: npm run db:push");
    } else {
      console.log(`\n  ${tables.length} tables: ${tables.map((t) => t.name).join(", ")}`);
    }

    console.log("\nConnection works.\n");
    await sql.end();
    process.exit(0);
  } catch (error) {
    await sql.end().catch(() => {});

    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string }).code ?? "";

    let hint = "";
    if (code === "ENOTFOUND" || message.includes("getaddrinfo")) {
      hint =
        "The hostname does not resolve. Check for a typo, and make sure you copied\n" +
        "the whole host including the .neon.tech ending.";
    } else if (code === "ECONNREFUSED") {
      hint = "Nothing is listening there. Check the host and port.";
    } else if (code === "CONNECT_TIMEOUT" || message.includes("timeout")) {
      hint =
        "Timed out. Usually a firewall, or a Neon project that is paused —\n" +
        "open the Neon dashboard and check the project is active.";
    } else if (/password|auth/i.test(message)) {
      hint =
        "Authentication failed. If your password contains special characters\n" +
        "(@ : / ? # etc.) it must be URL-encoded, or just reset it in Neon to\n" +
        "something alphanumeric.";
    } else if (/ssl|SSL/.test(message)) {
      hint = "SSL problem. Add ?sslmode=require to the end of the URL.";
    } else if (/database .* does not exist/i.test(message)) {
      hint = "That database name does not exist on the server. Check the part after the last /";
    }

    fail(`Could not connect.\n\n  ${message}${code ? `\n  (code ${code})` : ""}${hint ? `\n\n${hint}` : ""}`);
  }
}

main().catch((error) => {
  console.error("\nCheck failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
