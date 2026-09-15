"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase }),
    });
    setBusy(false);
    if (res.ok) {
      router.push("/");
      router.refresh();
    } else {
      setError("Wrong passphrase.");
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-col justify-center">
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Scheduler</h1>
      <p className="dim mb-6 text-sm">One schedule, every goal.</p>
      <form onSubmit={submit}>
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="Passphrase"
          autoFocus
          className="card w-full px-4 py-3 text-base outline-none"
          style={{ background: "var(--card)", color: "var(--fg)" }}
        />
        {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={busy || passphrase.length === 0}
          className="mt-3 w-full rounded-xl px-4 py-3 text-base font-medium disabled:opacity-40"
          style={{ background: "var(--fg)", color: "var(--bg)" }}
        >
          {busy ? "…" : "Enter"}
        </button>
      </form>
    </div>
  );
}
