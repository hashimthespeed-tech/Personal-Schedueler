"use client";

import { useEffect, useState } from "react";

const KEY = "install-hint-dismissed";

/**
 * iOS only delivers push to a PWA installed via Share -> Add to Home Screen.
 * Without this step the reminders silently never arrive, so it is worth one
 * prompt. Dismissal is a per-device convenience, so localStorage is the right
 * place for it — and it can throw in a private window, hence the try/catch.
 */
export function InstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(KEY) === "1";
    } catch {
      dismissed = false;
    }
    if (dismissed) return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as { standalone?: boolean }).standalone === true;
    const iOS = /iphone|ipad|ipod/i.test(window.navigator.userAgent);

    if (iOS && !standalone) setShow(true);
  }, []);

  if (!show) return null;

  return (
    <div className="card mb-4 p-4">
      <p className="text-sm font-medium">Add this to your home screen</p>
      <p className="dim mt-1 text-xs leading-relaxed">
        Tap Share, then <strong>Add to Home Screen</strong>. On iOS that's the only way
        reminders can reach you — notifications don't work in a Safari tab.
      </p>
      <button
        type="button"
        className="mt-3 text-xs font-medium underline"
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            /* private window — fine, it just asks again next time */
          }
          setShow(false);
        }}
      >
        Got it
      </button>
    </div>
  );
}
