import { requireSession } from "@/lib/auth";
import { checkSchema } from "@/lib/schema-guard";
import { SetupNeeded } from "@/components/SetupNeeded";
import { PlanView } from "@/components/PlanView";

export const dynamic = "force-dynamic";

/**
 * The week, before it becomes the week.
 *
 * Nobody owned the schedule: four specialists each added whatever came up in
 * whatever conversation was open, and the solver packed the result. This is
 * where one thing asks all four what the week needs, and shows you the answer
 * before you are living inside it.
 */
export default async function PlanPage() {
  await requireSession();

  const schema = await checkSchema();
  if (!schema.ok) return <div className="pt-6"><SetupNeeded status={schema} /></div>;

  return (
    <div className="pt-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Plan</h1>
        <p className="dim text-sm">What the week needs, asked of everyone at once.</p>
      </div>
      <PlanView />
    </div>
  );
}
