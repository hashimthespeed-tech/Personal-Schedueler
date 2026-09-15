import { requireSession } from "@/lib/auth";
import { CaptureForm } from "@/components/CaptureForm";

export const dynamic = "force-dynamic";

export default async function CapturePage() {
  await requireSession();

  return (
    <div className="pt-6">
      <h1 className="text-2xl font-semibold tracking-tight">Capture</h1>
      <p className="dim mb-5 text-sm">
        Photograph an assignment sheet and it becomes scheduled work. For actually being
        tutored, use the hub on a laptop.
      </p>
      <CaptureForm />
    </div>
  );
}
