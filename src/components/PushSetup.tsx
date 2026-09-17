"use client";

import { useEffect, useState } from "react";

type State = "unsupported" | "needs-install" | "prompt" | "granted" | "denied";

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

/**
 * Registers the service worker and subscribes to push.
 *
 * On iOS this only works inside an installed PWA, so the "needs-install" state
 * is a real outcome rather than an error — Safari reports notifications as
 * supported in a tab but silently never delivers.
 *
 * Nothing sends yet: `vercel.json` has no cron and `lib/push.ts` has no caller,
 * so subscribing stores the device and stops there. The copy says so rather
 * than promising a nudge that never comes. The subscription is the half that
 * has to exist first, and a browser only offers the permission prompt once —
 * so it stays, honestly labelled, instead of being deleted and asked for again.
 */
export function PushSetup() {
  const [state, setState] = useState<State>("prompt");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setState("unsupported");
      return;
    }

    const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;

    if (iOS && !standalone) {
      setState("needs-install");
      return;
    }

    if (Notification.permission === "granted") setState("granted");
    else if (Notification.permission === "denied") setState("denied");
    else setState("prompt");
  }, []);

  async function enable() {
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "prompt");
        return;
      }

      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set.");

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        }));

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      setState("granted");
    } catch {
      setState("denied");
    } finally {
      setBusy(false);
    }
  }

  const copy: Record<State, { title: string; body: string; action: boolean }> = {
    unsupported: {
      title: "Notifications unavailable",
      body: "This browser doesn't support web push.",
      action: false,
    },
    "needs-install": {
      title: "Add to home screen first",
      body: "On iOS, notifications only work from an installed app. Tap Share, then Add to Home Screen, then come back here.",
      action: false,
    },
    prompt: {
      title: "Allow reminders",
      body: "Sets this phone up to receive them. Nothing is being sent yet — the evening nudge to mark your day still has to be built.",
      action: true,
    },
    granted: {
      title: "This phone is ready for reminders",
      body: "Permission granted and the device is registered. Nothing sends yet, so you will not hear from it until the evening nudge is built.",
      action: false,
    },
    denied: {
      title: "Reminders blocked",
      body: "Notifications were declined. Re-enable them in your browser's site settings, then reload.",
      action: false,
    },
  };

  const current = copy[state];

  return (
    <section className="card p-4">
      <p className="text-sm font-medium">{current.title}</p>
      <p className="dim mt-1 text-xs leading-relaxed">{current.body}</p>
      {current.action && (
        <button
          type="button"
          onClick={enable}
          disabled={busy}
          className="mt-3 rounded-lg px-3 py-2 text-xs font-medium disabled:opacity-40"
          style={{ background: "var(--fg)", color: "var(--bg)" }}
        >
          {busy ? "…" : "Enable"}
        </button>
      )}
    </section>
  );
}
