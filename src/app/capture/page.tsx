import { requireSession } from "@/lib/auth";
import { SchoolworkPlanner } from "@/components/SchoolworkPlanner";
import { schoolworkPreview } from "@/data/schoolwork-preview";
import { today } from "@/core/clock";

export const dynamic = "force-dynamic";

export default async function CapturePage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  if (process.env.NODE_ENV === "development" && (await searchParams).preview === "1") {
    return <><p className="dim pt-5 text-xs">Design preview · sample data</p>
      <SchoolworkPlanner initialDate={schoolworkPreview.date} previewData={schoolworkPreview} /></>;
  }
  await requireSession();

  return <SchoolworkPlanner initialDate={today()} />;
}
