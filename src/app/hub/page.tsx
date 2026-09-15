import { asc, eq, desc } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/index";
import { agentThreads, blocks, tasks, unplaced } from "@/db/schema";
import { SPECIALISTS, SPECIALIST_NAMES, isSpecialist } from "@/agents/specialists";
import { requireSession } from "@/lib/auth";
import { AgentChat } from "@/components/AgentChat";
import { today } from "@/agents/context";
import { to12h } from "@/core/types";

export const dynamic = "force-dynamic";

/**
 * The desktop hub.
 *
 * The phone captures and shows the day; this is where the conversation
 * happens. Being tutored through a 6-inch screen with a soft keyboard is a
 * worse version of something that is fine on a laptop, so the phone does not
 * pretend to offer it.
 */
export default async function HubPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string }>;
}) {
  await requireSession();

  const { agent: requested } = await searchParams;
  const agent = requested && isSpecialist(requested) ? requested : "coach";
  const spec = SPECIALISTS[agent];
  const date = today();

  const [history, todayBlocks, openTasks, notFitting] = await Promise.all([
    db.select().from(agentThreads).where(eq(agentThreads.agent, agent)).orderBy(asc(agentThreads.createdAt)),
    db.select().from(blocks).where(eq(blocks.onDate, date)).orderBy(blocks.startMin),
    db.select().from(tasks).where(eq(tasks.status, "open")),
    db.select().from(unplaced).orderBy(desc(unplaced.createdAt)).limit(5),
  ]);

  const mine = openTasks.filter((t) => t.sourceAgent === agent);

  return (
    <div className="pt-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Hub</h1>
        <p className="dim text-sm">The full conversation. Your phone handles capture.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <div>
          <nav className="mb-4 flex gap-1.5">
            {SPECIALIST_NAMES.map((name) => (
              <Link
                key={name}
                href={`/hub?agent=${name}`}
                className="rounded-full px-3 py-1.5 text-xs font-medium"
                style={
                  name === agent
                    ? { background: "var(--fg)", color: "var(--bg)" }
                    : { border: "1px solid var(--line)", color: "var(--dim)" }
                }
              >
                {SPECIALISTS[name].label}
              </Link>
            ))}
          </nav>

          <header className="mb-4">
            <h2 className="text-lg font-semibold">{spec.label}</h2>
            <p className="dim text-sm">{spec.blurb}</p>
          </header>

          <AgentChat
            agent={agent}
            initial={history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content }))}
          />
        </div>

        <aside className="space-y-4">
          <section className="card p-3">
            <p className="dim mb-2 text-[11px] font-medium uppercase tracking-wide">Today</p>
            {todayBlocks.length === 0 ? (
              <p className="dim text-xs">Nothing scheduled.</p>
            ) : (
              <ul className="space-y-1">
                {todayBlocks.map((b) => (
                  <li key={b.id} className="text-xs">
                    <span className="dim tabular-nums">{to12h(b.startMin)}</span>{" "}
                    <span>{b.title}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-3">
            <p className="dim mb-2 text-[11px] font-medium uppercase tracking-wide">
              {spec.label}&apos;s tasks ({mine.length})
            </p>
            {mine.length === 0 ? (
              <p className="dim text-xs">None yet.</p>
            ) : (
              <ul className="space-y-1">
                {mine.map((t) => (
                  <li key={t.id} className="text-xs">
                    {t.title}
                    <span className="dim"> · {t.durationMin}min</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {notFitting.length > 0 && (
            <section className="card p-3">
              <p className="dim mb-2 text-[11px] font-medium uppercase tracking-wide">Didn&apos;t fit</p>
              <ul className="space-y-1.5">
                {notFitting.map((u) => (
                  <li key={u.id} className="text-xs">
                    {u.title}
                    <span className="dim block">{u.detail}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <Link href="/manage" className="card block p-3 text-xs font-medium">
            Manage tasks →
          </Link>
        </aside>
      </div>
    </div>
  );
}
