import { requireSession } from "@/lib/auth";
import { checkSchema } from "@/lib/schema-guard";
import { SetupNeeded } from "@/components/SetupNeeded";
import { HubView } from "@/components/HubView";

export const dynamic = "force-dynamic";

/**
 * The desktop hub.
 *
 * The phone captures and shows the day; this is where the conversation
 * happens. It takes the whole window rather than the reading column every
 * other page uses — see Shell.
 */
export default async function HubPage() {
  await requireSession();

  const schema = await checkSchema();
  if (!schema.ok) {
    return (
      <div className="mx-auto w-full max-w-lg px-4 pb-28 pt-6 lg:max-w-4xl">
        <SetupNeeded status={schema} />
      </div>
    );
  }

  return <HubView />;
}
