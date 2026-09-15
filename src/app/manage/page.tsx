import { requireSession } from "@/lib/auth";
import { ManageView } from "@/components/ManageView";

export const dynamic = "force-dynamic";

export default async function ManagePage() {
  await requireSession();

  return (
    <div className="pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Manage</h1>
      <p className="dim mb-5 text-sm">
        Delete tasks or clear the schedule. What you have already marked done is never
        touched — that record stays.
      </p>
      <ManageView />
    </div>
  );
}
