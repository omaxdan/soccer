"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import {
  IconBoard,
  IconModules,
  IconFixtures,
  IconMethod,
} from "./icons/ModuleIcons";

type Item = {
  href: string;
  label: string;
  Icon: (p: { size?: number; className?: string }) => React.ReactElement;
};

const items: Item[] = [
  { href: "/", label: "Feed", Icon: IconBoard },
  { href: "/modules", label: "Modules", Icon: IconModules },
  { href: "/matches", label: "Fixtures", Icon: IconFixtures },
  { href: "/method", label: "Method", Icon: IconMethod },
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
        {items.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex flex-col items-center gap-1 py-2.5"
                style={{ color: active ? "var(--amber)" : "var(--muted)" }}
              >
                <Icon size={18} />
                <span className="mono text-[0.6rem] uppercase tracking-widest">{label}</span>
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
    <nav aria-label="Primary" className="hidden md:sticky md:top-16 md:flex md:flex-col md:gap-1">
      {items.map(({ href, label, Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className="flex items-center gap-3 rounded-term px-3 py-2 text-sm transition-colors hover:bg-raised"
            style={{
              color: active ? "var(--text)" : "var(--muted)",
              background: active ? "var(--raised)" : "transparent",
            }}
          >
            <span style={{ color: active ? "var(--amber)" : "var(--faint)" }}>
              <Icon size={17} />
            </span>
            <span className="tracking-tight">{label}</span>
          </Link>
        );
      })}

      <Link
        href="/pricing"
        className="mono mt-3 rounded-term px-3 py-2 text-center text-[0.62rem] font-semibold tracking-widest transition-colors"
        style={{
          color: "var(--amber)",
          border: "1px solid color-mix(in srgb, var(--amber) 30%, transparent)",
        }}
      >
        PRICING
      </Link>
    </nav>
  );
}
