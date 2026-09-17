import { requireSession } from "@/lib/auth";
import { checkSchema } from "@/lib/schema-guard";
import { SetupNeeded } from "@/components/SetupNeeded";
import { DayView } from "@/components/DayView";
import { SleepCard } from "@/components/SleepCard";
import { today } from "@/core/clock";

export const dynamic = "force-dynamic";

/**
 * The day.
 *
 * Fixed template, computed fresh from the date — nothing is stored but what
 * happened. The whole loop is here: report last night, then tick or cross the
 * seven things that are scored.
 */
export default async function TodayPage() {
  await requireSession();

  const schema = await checkSchema();
  if (!schema.ok) return <div className="pt-6"><SetupNeeded status={schema} /></div>;

  const date = today();

  return (
    <div className="space-y-5 pt-6">
      <SleepCard date={date} />
      <DayView initialDate={date} />
    </div>
  );
}
