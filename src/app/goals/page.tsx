import { requireSession } from "@/lib/auth";
import { GoalsDashboard } from "@/components/GoalsDashboard";
import { goalPreview } from "@/data/goals-preview";
import "./goals.css";

export const dynamic = "force-dynamic";

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  if (process.env.NODE_ENV === "development" && (await searchParams).preview === "1") {
    return <><p className="goals-preview-label">Design preview · sample data</p><GoalsDashboard previewData={goalPreview} /></>;
  }
  await requireSession();
  return <GoalsDashboard />;
}
