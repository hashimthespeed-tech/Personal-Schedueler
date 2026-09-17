"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Two navigations, chosen by viewport rather than by user agent.
 *
 * The phone is for capture and for the day: photograph an assignment, see
 * what is next, tick things off. The hub — the actual conversations — is
 * desktop-only in the nav, because being tutored through a soft keyboard is a
 * worse version of something that is fine on a laptop.
 *
 * `/hub` still resolves on a phone if you follow a link to it. Hiding it is
 * about not promoting the worse path, not about locking a door.
 */
const PHONE = [
  { href: "/", label: "Today" },
  { href: "/capture", label: "Due" },
  { href: "/stats", label: "Stats" },
];

const DESKTOP = [
  { href: "/", label: "Today" },
  { href: "/capture", label: "Due" },
  { href: "/stats", label: "Stats" },
  { href: "/settings", label: "Settings" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavBar() {
  const pathname = usePathname();
  if (pathname === "/login") return null;

  return (
    <nav
      className="fixed inset-x-0 bottom-0 border-t backdrop-blur"
      style={{
        borderColor: "var(--line)",
        background: "color-mix(in srgb, var(--bg) 88%, transparent)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)",
      }}
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 pt-2 lg:hidden">
        {PHONE.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="flex-1 rounded-lg px-2 py-2 text-center text-[13px] font-medium"
            style={{ color: isActive(pathname, link.href) ? "var(--fg)" : "var(--dim)" }}
          >
            {link.label}
          </Link>
        ))}
      </div>

      <div className="mx-auto hidden max-w-4xl items-stretch justify-center gap-1 px-2 pt-2 lg:flex">
        {DESKTOP.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-lg px-4 py-2 text-center text-[13px] font-medium"
            style={{ color: isActive(pathname, link.href) ? "var(--fg)" : "var(--dim)" }}
          >
            {link.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}
