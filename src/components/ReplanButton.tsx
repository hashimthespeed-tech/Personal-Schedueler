"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReplanButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/replan", { method: "POST" });
        setBusy(false);
        router.refresh();
      }}
      className="card px-3 py-1.5 text-xs font-medium disabled:opacity-40"
    >
      {busy ? "Solving…" : "Replan"}
    </button>
  );
}
