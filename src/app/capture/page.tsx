import { requireSession } from "@/lib/auth";
import { SchoolworkPlanner } from "@/components/SchoolworkPlanner";
import { schoolworkExactMinutePreview, schoolworkLatePreview, schoolworkNinePmPreview, schoolworkPressurePreview, schoolworkPreview, schoolworkShortNoticePreview } from "@/data/schoolwork-preview";
import { today } from "@/core/clock";

export const dynamic = "force-dynamic";

export default async function CapturePage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const preview = (await searchParams).preview;
  if (process.env.NODE_ENV === "development" && preview) {
    return <><p className="dim pt-5 text-xs">Design preview · sample data</p>
      <SchoolworkPlanner initialDate={schoolworkPreview.date}
        previewData={preview === "pressure" ? schoolworkPressurePreview :
          preview === "late" ? schoolworkLatePreview :
          preview === "nine" ? schoolworkNinePmPreview :
          preview === "short" ? schoolworkShortNoticePreview :
          preview === "exact" ? schoolworkExactMinutePreview : schoolworkPreview} /></>;
  }
  await requireSession();

  return <SchoolworkPlanner initialDate={today()} />;
}
