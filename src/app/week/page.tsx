import { requireSession } from "@/lib/auth";
import { today } from "@/core/clock";
import { WeekPlanner } from "@/components/WeekPlanner";
import { weekPreview } from "@/data/week-preview";

export const dynamic = "force-dynamic";

export default async function WeekPage({ searchParams }: { searchParams: Promise<{ preview?: string; edit?: string; delete?: string }> }) {
  const params = await searchParams;
  if (process.env.NODE_ENV === "development" && params.preview === "1") {
    return <WeekPlanner initialDate="2026-09-22" previewData={weekPreview}
      previewEditId={params.edit ? Number(params.edit) : undefined}
      previewDeleteId={params.delete ? Number(params.delete) : undefined} />;
  }
  await requireSession();
  return <WeekPlanner initialDate={today()} />;
}
