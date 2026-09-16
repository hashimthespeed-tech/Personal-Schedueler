import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/index";
import { conversations, courses, gems } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { gemSeeds } from "@/data/gems";
import { syncGems } from "@/agents/gem";

export const dynamic = "force-dynamic";

/**
 * The sidebar: every gem with its recent conversations.
 *
 * The roster is synced from the courses table on read, so adding a class in
 * one place gives it a tutor everywhere without a separate migration step.
 */
export async function GET() {
  const session = await getSession();
  if (!session.loggedIn) return NextResponse.json({ ok: false }, { status: 401 });

  const courseRows = await db.select().from(courses).orderBy(courses.period);
  await syncGems(gemSeeds(courseRows));

  const all = await db.select().from(gems).where(eq(gems.active, true));
  const recent = await db
    .select()
    .from(conversations)
    .where(eq(conversations.archived, false))
    .orderBy(desc(conversations.updatedAt));

  return NextResponse.json({
    ok: true,
    gems: all
      .sort((a, b) => a.category.localeCompare(b.category) || a.sortOrder - b.sortOrder)
      .map((g) => ({
        id: g.id,
        key: g.key,
        label: g.label,
        blurb: g.blurb,
        category: g.category,
        domain: g.domain,
        hasMemory: Boolean(g.memory),
        conversations: recent
          .filter((c) => c.gemId === g.id)
          .slice(0, 12)
          .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt })),
      })),
  });
}
