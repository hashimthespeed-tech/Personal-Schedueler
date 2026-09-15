import { eq } from "drizzle-orm";
import { db } from "@/db/index";
import { blocks, checkIns } from "@/db/schema";
import { today } from "@/agents/context";
import { requireSession } from "@/lib/auth";
import { CheckInForm } from "@/components/CheckInForm";

export const dynamic = "force-dynamic";

export default async function CheckInPage() {
  await requireSession();

  const date = today();
  const [todayBlocks, existing] = await Promise.all([
    db.select().from(blocks).where(eq(blocks.onDate, date)).orderBy(blocks.startMin),
    db.select().from(checkIns).where(eq(checkIns.onDate, date)).limit(1),
  ]);

  return (
    <div className="pt-6">
      <header className="mb-1">
        <h1 className="text-2xl font-semibold tracking-tight">Check in</h1>
      </header>
      <p className="dim mb-5 text-sm">Four taps. Everything else gets figured out.</p>

      <CheckInForm
        date={date}
        blocks={todayBlocks.map((b) => ({ id: b.id, title: b.title, domain: b.domain }))}
        alreadyDone={existing.length > 0}
      />
    </div>
  );
}
