"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React, { useState, useEffect } from "react";
import {
  NavToday,
  NavMatches,
  NavSaved,
  NavLeagues,
  NavTeams,
  NavUsers,
  NavPlayers,
  NavSearch,
  NavTrends,
  NavModules,
  NavMethod,
  NavSubscription,
  NavSettings,
  NavSignIn,
  NavSignOut,
  NavAdmin,
  NavFlags,
  NavMore,
} from "./icons/NavIcons";

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
      { href: "/app", label: "Dashboard", Icon: NavToday },
      { href: "/matches", label: "Match Board", Icon: NavMatches },
      { href: "/watchlist", label: "Watchlist", Icon: NavSaved },
    ],
  },
  {
    title: "Intelligence",
    items: [
      { href: "/leagues", label: "Leagues", Icon: NavLeagues },
      { href: "/teams", label: "Teams", Icon: NavTeams },
      { href: "/players", label: "Players", Icon: NavPlayers },
    ],
  },
  {
    title: "Tools",
    items: [
      { href: "/search", label: "Search", Icon: NavSearch },
      { href: "/trends", label: "Trends", Icon: NavTrends },
      { href: "/modules", label: "Module Library", Icon: NavModules },
      { href: "/method", label: "Method", Icon: NavMethod },
    ],
  },
  {
    title: "Account",
    items: [
      { href: "/subscription", label: "Subscription", Icon: NavSubscription },
      { href: "/settings", label: "Settings", Icon: NavSettings },
    ],
  },
];

/** The four that earn a place in a five-slot mobile bar. */
/**
 * Mobile tabs, ordered by how often the action is actually taken rather than by
 * mirroring the sidebar.
 *
 * The sidebar mirror put Module Library — a reference page read once — in a
 * daily slot, while Watchlist, the one surface a returning user opens on
 * purpose, had no route on a phone at all. The sidebar is `hidden md:flex`, so
 * these tabs are the ONLY navigation below md: anything missing here is
 * unreachable, which is why the fifth tab is a full menu rather than a fifth
 * destination.
 */
const MOBILE_PRIMARY: Item[] = [
  { href: "/app", label: "Today", Icon: NavToday },
  { href: "/matches", label: "Matches", Icon: NavMatches },
  { href: "/watchlist", label: "Saved", Icon: NavSaved },
  { href: "/leagues", label: "Leagues", Icon: NavLeagues },
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
    { href: "/subscription", label: "Subscription", Icon: NavSubscription },
    { href: "/settings", label: "Settings", Icon: NavSettings },
    identity.authenticated
      ? { href: "/logout", label: "Sign out", Icon: NavSignOut }
      : { href: "/login", label: "Sign in", Icon: NavSignIn },
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
      { href: "/admin/settings", label: "Admin Settings", Icon: NavAdmin },
      { href: "/admin/users", label: "Users", Icon: NavUsers },
      { href: "/admin/subscriptions", label: "Subscriptions", Icon: NavSubscription },
      { href: "/admin/usage", label: "Usage", Icon: NavTrends, stub: true },
      { href: "/admin/settings#features", label: "Feature Flags", Icon: NavFlags },
    ],
  };
}

function isActive(pathname: string, href: string) {
  if (href === "/app") return pathname === "/app";
  return pathname.startsWith(href);
}

export function BottomNav({
  identity = { authenticated: false, isAdmin: false },
}: {
  identity?: NavIdentity;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close on navigation. Without this the sheet stays open over the page the
  // user just chose, which reads as the tap having failed.
  useEffect(() => setOpen(false), [pathname]);

  // Everything not in the primary four, so no destination becomes unreachable
  // on a phone.
  const overflow: Group[] = [
    { title: "Intelligence", items: [GROUPS[1].items[1], GROUPS[1].items[2]] },
    { title: "Tools", items: GROUPS[2].items.filter((i) => i.href !== "/leagues") },
    { title: "Account", items: accountItems(identity) },
    ...(identity.isAdmin ? [adminGroup()] : []),
  ];
  const inOverflow = overflow.some((g) =>
    g.items.some((i) => isActive(pathname, i.href))
  );

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {open && (
        <div
          id="mobile-more"
          className="max-h-[60vh] overflow-y-auto border-b border-line px-3 py-3"
        >
          {overflow.map((group) => (
            <div key={group.title} className="mb-3 last:mb-0">
              <div className="label-cap mb-1">{group.title}</div>
              <ul className="grid grid-cols-2 gap-1">
                {group.items.map(({ href, label, Icon, stub }) => (
                  <li key={href}>
                    <Link
                      href={href}
                      className="flex items-center gap-2 rounded-term px-2 py-2 text-[0.74rem]"
                      style={{
                        color: isActive(pathname, href) ? "var(--text)" : "var(--muted)",
                        background: isActive(pathname, href) ? "var(--raised)" : "transparent",
                      }}
                    >
                      <span className="text-faint">
                        <Icon size={14} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      {stub && (
                        <span className="mono shrink-0 text-[0.5rem] tracking-widest text-faint">
                          SOON
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <ul className="grid grid-cols-5">
        {MOBILE_PRIMARY.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className="flex min-h-[3rem] flex-col items-center justify-center gap-1 py-2"
                style={{ color: active ? "var(--amber)" : "var(--muted)" }}
              >
                <Icon size={18} />
                <span className="mono text-[0.55rem] uppercase tracking-widest">{label}</span>
              </Link>
            </li>
          );
        })}
        <li>
          {/* Label mirrors the summary above via the CSS sibling state, so the
              fifth tab toggles the sheet without any JavaScript. */}
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-more"
            onClick={() => setOpen((v) => !v)}
            className="flex min-h-[3rem] w-full flex-col items-center justify-center gap-1 py-2"
            style={{ color: open || inOverflow ? "var(--amber)" : "var(--muted)" }}
          >
            <NavMore size={18} />
            <span className="mono text-[0.55rem] uppercase tracking-widest">More</span>
          </button>
        </li>
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
