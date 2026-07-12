"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Board", glyph: "▚" },
  { href: "/matches", label: "Fixtures", glyph: "◫" },
  { href: "/leagues", label: "Leagues", glyph: "⬗" },
  { href: "/method", label: "Method", glyph: "ƒ" },
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-4">
        {items.map((it) => {
          const active = isActive(pathname, it.href);
          return (
            <li key={it.href}>
              <Link
                href={it.href}
                className="flex flex-col items-center gap-1 py-2.5"
                style={{ color: active ? "var(--amber)" : "var(--muted)" }}
              >
                <span className="text-base leading-none" aria-hidden>
                  {it.glyph}
                </span>
                <span className="mono text-[0.6rem] tracking-widest uppercase">
                  {it.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SideNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="hidden md:flex md:flex-col md:gap-1 md:sticky md:top-16"
    >
      {items.map((it) => {
        const active = isActive(pathname, it.href);
        return (
          <Link
            key={it.href}
            href={it.href}
            className="flex items-center gap-3 rounded-term px-3 py-2 text-sm transition-colors hover:bg-raised"
            style={{
              color: active ? "var(--text)" : "var(--muted)",
              background: active ? "var(--raised)" : "transparent",
            }}
          >
            <span
              className="mono text-base"
              aria-hidden
              style={{ color: active ? "var(--amber)" : "var(--faint)" }}
            >
              {it.glyph}
            </span>
            <span className="tracking-tight">{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
