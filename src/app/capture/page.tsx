import { requireSession } from "@/lib/auth";
import { CaptureForm } from "@/components/CaptureForm";

export const dynamic = "force-dynamic";

export default async function CapturePage() {
  await requireSession();

  return (
    <div className="pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">What's due</h1>
      <p className="dim text-sm">Off the whiteboard, before it's gone.</p>
      <CaptureForm />
    </div>
  );
}
