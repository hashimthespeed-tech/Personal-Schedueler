"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Today" },
  { href: "/week", label: "Week" },
  { href: "/checkin", label: "Check in" },
  { href: "/agents/coach", label: "Agents" },
];

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
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 pt-2">
        {LINKS.map((link) => {
          const active =
            link.href === "/" ? pathname === "/" : pathname.startsWith(link.href.split("/")[1] ? `/${link.href.split("/")[1]}` : link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex-1 rounded-lg px-2 py-2 text-center text-[13px] font-medium"
              style={{ color: active ? "var(--fg)" : "var(--dim)" }}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
