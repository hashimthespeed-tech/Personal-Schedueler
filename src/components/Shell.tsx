"use client";

import { usePathname } from "next/navigation";

/**
 * The page container, chosen by route.
 *
 * Every screen here is a narrow reading column — a day, a form, a set of
 * numbers — except the hub, which is a two-pane workspace and wants the whole
 * window. Constraining it to the same 56rem column leaves the sidebar floating
 * in the middle of an empty page.
 */
export function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/hub") {
    return <main className="w-full">{children}</main>;
  }

  return <main className="mx-auto w-full max-w-lg px-4 pb-28 lg:max-w-4xl">{children}</main>;
}
