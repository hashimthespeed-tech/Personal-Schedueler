import { requireSession } from "@/lib/auth";
import { DebugView } from "@/components/DebugView";

export const dynamic = "force-dynamic";

export default async function DebugPage() {
  await requireSession();

  return (
    <div className="pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">State</h1>
      <p className="dim mb-5 text-sm">
        Everything the scheduler currently knows. Tap Copy and paste it into a chat
        when you want help reading the plan.
      </p>
      <DebugView />
    </div>
  );
}
