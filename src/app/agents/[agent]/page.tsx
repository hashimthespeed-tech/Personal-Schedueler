import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/db/index";
import { agentThreads } from "@/db/schema";
import { SPECIALISTS, SPECIALIST_NAMES, isSpecialist } from "@/agents/specialists";
import { requireSession } from "@/lib/auth";
import { AgentChat } from "@/components/AgentChat";

export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ agent: string }> }) {
  await requireSession();

  const { agent } = await params;
  if (!isSpecialist(agent)) notFound();

  const spec = SPECIALISTS[agent];
  const history = await db
    .select()
    .from(agentThreads)
    .where(eq(agentThreads.agent, agent))
    .orderBy(asc(agentThreads.createdAt));

  return (
    <div className="pt-6">
      <nav className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {SPECIALIST_NAMES.map((name) => (
          <Link
            key={name}
            href={`/agents/${name}`}
            className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium"
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
        <h1 className="text-2xl font-semibold tracking-tight">{spec.label}</h1>
        <p className="dim text-sm">{spec.blurb}</p>
      </header>

      <AgentChat
        agent={agent}
        initial={history.map((h) => ({ role: h.role as "user" | "assistant", content: h.content }))}
      />
    </div>
  );
}
