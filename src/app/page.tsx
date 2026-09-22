import { requireSession } from "@/lib/auth";
import { checkSchema } from "@/lib/schema-guard";
import { SetupNeeded } from "@/components/SetupNeeded";
import { DayView } from "@/components/DayView";
import { SleepCard } from "@/components/SleepCard";
import { today } from "@/core/clock";
import { DailyCompletionGraph } from "@/components/DailyCompletionGraph";
import { completionPreview } from "@/data/completion-preview";

export const dynamic = "force-dynamic";

/**
 * The day.
 *
 * Fixed template, computed fresh from the date — nothing is stored but what
 * happened. The whole loop is here: report last night, then tick or cross the
 * seven things that are scored.
 */
export default async function TodayPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  if (process.env.NODE_ENV === "development" && (await searchParams).preview === "1") {
    return <div className="space-y-5 pt-6">
      <p className="dim text-xs">Design preview · sample data</p>
      <DailyCompletionGraph previewData={completionPreview} />
    </div>;
  }
  await requireSession();

  const schema = await checkSchema();
  if (!schema.ok) return <div className="pt-6"><SetupNeeded status={schema} /></div>;

  const date = today();

  return (
    <div className="space-y-5 pt-6">
      <DailyCompletionGraph />
      <SleepCard date={date} />
      <DayView initialDate={date} />
    </div>
  );
}
