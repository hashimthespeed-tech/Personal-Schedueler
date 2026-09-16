import type { SchemaStatus } from "@/lib/schema-guard";

export function SetupNeeded({ status }: { status: SchemaStatus }) {
  const unreachable = status.missingTables[0]?.startsWith("(");

  return (
    <div className="pt-10">
      <h1 className="text-2xl font-semibold tracking-tight">The database is behind</h1>
      <p className="dim mt-1 text-sm">
        {unreachable
          ? "The app cannot reach the database."
          : "The code expects columns this database does not have yet. One command fixes it."}
      </p>

      {!unreachable && (
        <div className="card mt-5 p-4">
          <p className="text-sm font-medium">Run this where you cloned the repo</p>
          <pre
            className="mt-2 overflow-x-auto rounded-lg p-3 text-xs"
            style={{ background: "var(--line)" }}
          >
{`git pull
npm run db:push`}
          </pre>
          <p className="dim mt-2 text-xs leading-relaxed">
            Then reload this page. Nothing is lost — db:push only adds what is missing.
          </p>
        </div>
      )}

      {status.missingTables.length > 0 && (
        <section className="card mt-4 p-4">
          <p className="text-sm font-medium">Missing tables</p>
          <ul className="dim mt-1 space-y-0.5 text-xs">
            {status.missingTables.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          {!unreachable && (
            <p className="dim mt-2 text-xs">
              If db:push has never run here, follow it with <code>npm run db:seed</code>.
            </p>
          )}
        </section>
      )}

      {status.missingColumns.length > 0 && (
        <section className="card mt-4 p-4">
          <p className="text-sm font-medium">Missing columns</p>
          <ul className="dim mt-1 space-y-0.5 text-xs">
            {status.missingColumns.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      {unreachable && (
        <div className="card mt-5 p-4">
          <p className="text-sm font-medium">Check the connection</p>
          <pre
            className="mt-2 overflow-x-auto rounded-lg p-3 text-xs"
            style={{ background: "var(--line)" }}
          >
{`npm run db:check`}
          </pre>
          <p className="dim mt-2 text-xs leading-relaxed">
            It names what is wrong with DATABASE_URL. If you changed it on Vercel, redeploy —
            environment variables only take effect on a new deployment.
          </p>
        </div>
      )}
    </div>
  );
}
