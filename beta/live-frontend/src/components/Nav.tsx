"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";
import {
  IconBoard,
  IconModules,
  IconFixtures,
  IconMethod,
  IconConfidence,
  IconHomeAway,
  IconGiantKiller,
  IconReadiness,
  IconTravel,
  IconCleanSheet,
  IconGate,
  IconLock,
} from "./icons/ModuleIcons";

type Item = {
  href: string;
  label: string;
  Icon: (p: { size?: number; className?: string }) => React.ReactElement;
  /** Structure only for now — marked so the UI does not overpromise. */
  stub?: boolean;
};

type Group = { title: string; items: Item[] };

/**
 * Four groups, matching how the product is actually used: what to look at now,
 * what to look it up in, what to explore with, and account.
 *
 * Icons are the existing stroke SVG set — no emoji, consistent with the rest
 * of the terminal.
 */
const GROUPS: Group[] = [
  {
    title: "Main",
    items: [
      { href: "/app", label: "Dashboard", Icon: IconBoard },
      { href: "/matches", label: "Match Board", Icon: IconFixtures },
      { href: "/watchlist", label: "Watchlist", Icon: IconCleanSheet, stub: true },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { href: "/leagues", label: "Leagues", Icon: IconGiantKiller },
      { href: "/teams", label: "Teams", Icon: IconHomeAway },
      { href: "/players", label: "Players", Icon: IconReadiness, stub: true },
    ],
  },
  {
    title: "Tools",
    items: [
      { href: "/search", label: "Search", Icon: IconTravel, stub: true },
      { href: "/trends", label: "Trends", Icon: IconConfidence },
      { href: "/modules", label: "Module Library", Icon: IconModules },
      { href: "/method", label: "Method", Icon: IconMethod },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/subscription", label: "Subscription", Icon: IconGate },
      { href: "/settings", label: "Settings", Icon: IconLock },
    ],
  },
];

/** The four that earn a place in a five-slot mobile bar. */
const MOBILE: Item[] = [
  GROUPS[0].items[0],
  GROUPS[0].items[1],
  GROUPS[1].items[0],
  GROUPS[2].items[2],
];

export interface NavIdentity {
  authenticated: boolean;
  isAdmin: boolean;
}

/**
 * The account row depends on the session, so it is built per render rather
 * than living in the static GROUPS table. Admin controls only appear for an
 * admin — the route rejects everyone else anyway, but advertising a door
 * nobody can open is noise.
 */
function accountItems(identity: NavIdentity): Item[] {
  return [
    { href: "/subscription", label: "Subscription", Icon: IconGate },
    { href: "/settings", label: "Settings", Icon: IconLock },
    identity.authenticated
      ? { href: "/logout", label: "Sign out", Icon: IconMethod }
      : { href: "/login", label: "Sign in", Icon: IconMethod },
  ];
}

/**
 * Platform controls, admins only. Kept as its own group rather than an extra
 * Account row so the two never read as the same kind of thing — a user's plan
 * and the platform's feature flags are different concerns.
 */
function adminGroup(): Group {
  return {
    title: "Admin",
    items: [
      { href: "/admin/settings", label: "Admin Settings", Icon: IconConfidence },
      { href: "/admin/users", label: "Users", Icon: IconHomeAway },
      { href: "/admin/settings#features", label: "Feature Flags", Icon: IconGate },
    ],
  };
}

function isActive(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname.startsWith(href);
}

export function BottomNav(_props: { identity?: NavIdentity }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 backdrop-blur md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="grid grid-cols-4">
        {MOBILE.map(({ href, label, Icon }) => {
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
                <span className="mono text-[0.55rem] uppercase tracking-widest">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SideNav({
  identity = { authenticated: false, isAdmin: false },
}: {
  identity?: NavIdentity;
}) {
  const pathname = usePathname();
  const groups = [
    ...GROUPS.map((g) =>
      g.title === "Account" ? { ...g, items: accountItems(identity) } : g
    ),
    ...(identity.isAdmin ? [adminGroup()] : []),
  ];
  return (
    <nav
      aria-label="Primary"
      className="hidden md:sticky md:top-16 md:flex md:flex-col md:gap-4"
    >
      {groups.map((group) => (
        <div key={group.title}>
          <div className="label-cap mb-1 px-3">{group.title}</div>
          <ul className="flex flex-col gap-0.5">
            {group.items.map(({ href, label, Icon, stub }) => {
              const active = isActive(pathname, href);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className="flex items-center gap-2.5 rounded-term px-3 py-1.5 text-[0.8rem] transition-colors hover:bg-raised"
                    style={{
                      color: active ? "var(--text)" : "var(--muted)",
                      background: active ? "var(--raised)" : "transparent",
                    }}
                  >
                    <span style={{ color: active ? "var(--amber)" : "var(--faint)" }}>
                      <Icon size={15} />
                    </span>
                    <span className="tracking-tight">{label}</span>
                    {stub && (
                      <span className="mono ml-auto text-[0.5rem] tracking-widest text-faint">
                        SOON
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
