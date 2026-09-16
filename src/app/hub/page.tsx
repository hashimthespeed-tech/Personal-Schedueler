import { requireSession } from "@/lib/auth";
import { checkSchema } from "@/lib/schema-guard";
import { SetupNeeded } from "@/components/SetupNeeded";
import { HubView } from "@/components/HubView";

export const dynamic = "force-dynamic";

export default async function HubPage() {
  await requireSession();

  const schema = await checkSchema();
  if (!schema.ok) return <SetupNeeded status={schema} />;

  return (
    <div className="pt-6">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Hub</h1>
        <p className="dim text-sm">The full conversation. Your phone handles capture.</p>
      </div>
      <HubView />
    </div>
  );
}
