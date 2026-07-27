// ─────────────────────────────────────────────────────────────────────────────
// FeedTable — the board and the schedule, as a high-level intelligence summary.
//
// Was thirteen module columns per fixture, which forced a reader to learn
// internal abbreviations and could not fit a phone without horizontal scroll.
// Now three fields: how much intelligence exists, how strongly it agrees, and
// which side it favours. The per-module breakdown lives on the match page,
// which is where someone who wants it is already going.
//
// Nothing about the modules changed. tally() and overallVerdict() are the same
// functions, over the same readings; this only stops rendering each one.
//
// One row per fixture, six columns, no horizontal scroll at 375px.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import Link from "next/link";
import { tally, overallVerdict, derivePickSide, MODULES } from "@/lib/modules";
import type { MatchRow } from "@/lib/types";
import type { Tier } from "@/lib/tier";
import { Crest } from "./Crest";
import { kickoff } from "@/lib/intel";
import { matchSlug } from "@/lib/slug";
import type { FeedEntry } from "./ModuleFeed";

export type FeedGrouping = "league" | "day";

function groupLabel(e: FeedEntry, by: FeedGrouping): string {
  if (by === "day")
    return new Date(e.match.date).toLocaleDateString(undefined, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  return e.match.competition ?? e.match.tournament?.name ?? "Other";
}

/** Fills a cell with a link to the fixture so the whole row is a target. */
function CellLink({
  href,
  children,
  label,
  className = "",
}: {
  href: string;
  children: React.ReactNode;
  label?: string;
  className?: string;
}) {
  const hidden = label == null;
  return (
    <Link
      href={href}
      aria-label={label}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      className={`block h-full w-full ${className}`}
    >
      {children}
    </Link>
  );
}

function TeamLine({ team, side }: { team: MatchRow["home"]; side: "H" | "A" }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Crest team={team} size={15} />
      <span className="mono truncate text-[0.7rem] font-semibold text-text md:text-[0.76rem]">
        {team.short_name || team.name}
      </span>
      <span className="mono ml-auto shrink-0 text-[0.5rem] text-faint">{side}</span>
    </span>
  );
}

export function FeedTable({
  entries,
  viewer: _viewer,
  groupBy = "league",
  maxHeight = "calc(100vh - 11rem)",
}: {
  entries: FeedEntry[];
  viewer: Tier;
  groupBy?: FeedGrouping;
  maxHeight?: string;
}) {
  const groups = new Map<string, FeedEntry[]>();
  for (const e of entries) {
    const key = groupLabel(e, groupBy);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  const head =
    "sticky top-0 z-20 whitespace-nowrap bg-panel px-2 py-2 text-left font-normal";

  return (
    <div className="panel overflow-y-auto" style={{ maxHeight }}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className={head}>
              <span className="label-cap">Time</span>
            </th>
            {/* Competition is the group header when grouping by league, so it
                only earns a column on the schedule view. Hidden on mobile
                either way — it is the least load-bearing field here. */}
            {groupBy === "day" && (
              <th className={`${head} hidden md:table-cell`}>
                <span className="label-cap">Competition</span>
              </th>
            )}
            <th className={head}>
              <span className="label-cap">Fixture</span>
            </th>
            <th className={`${head} text-center`}>
              <span className="label-cap">Modules</span>
            </th>
            <th className={head}>
              <span className="label-cap">Consensus</span>
            </th>
            <th className={head}>
              <span className="label-cap">Pick side</span>
            </th>
          </tr>
        </thead>

        {[...groups.entries()].map(([label, list]) => (
          <tbody key={label}>
            <tr>
              <td
                colSpan={groupBy === "day" ? 6 : 5}
                className="mono border-y border-line bg-raised px-2 py-1 text-[0.6rem] uppercase tracking-[0.14em] text-muted"
              >
                {label}
                <span className="ml-2 tnum text-faint">{list.length}</span>
              </td>
            </tr>

            {list.map((e) => {
              const m = e.match;
              const k = kickoff(m.date);
              const t = tally(e.readings);
              const overall = overallVerdict(t);
              const firing = e.readings.filter((r) => r.status !== "inactive").length;
              const pickSide = derivePickSide(m);
              const pickName =
                pickSide === "home"
                  ? m.home.short_name || m.home.name
                  : pickSide === "away"
                    ? m.away.short_name || m.away.name
                    : null;
              const href = `/match/${matchSlug(m)}`;
              const homeName = m.home.short_name || m.home.name;
              const awayName = m.away.short_name || m.away.name;

              return (
                <tr
                  key={m.id}
                  className="border-t border-line transition-colors hover:bg-raised"
                >
                  <td className="px-2 py-2 align-middle">
                    <CellLink
                      href={href}
                      label={`${homeName} versus ${awayName}, ${k.day} ${k.time}`}
                    >
                      <span className="mono block text-[0.62rem] text-faint">{k.day}</span>
                      <span className="mono tnum block text-[0.74rem] text-text">{k.time}</span>
                    </CellLink>
                  </td>

                  {groupBy === "day" && (
                    <td className="hidden max-w-[10rem] px-2 py-2 align-middle md:table-cell">
                      <CellLink href={href}>
                        <span className="mono truncate text-[0.66rem] text-muted">
                          {m.competition ?? m.tournament?.name ?? "—"}
                        </span>
                      </CellLink>
                    </td>
                  )}

                  <td className="min-w-[8rem] px-2 py-1.5 align-middle">
                    <CellLink href={href}>
                      <span className="flex flex-col gap-1">
                        <TeamLine team={m.home} side="H" />
                        <TeamLine team={m.away} side="A" />
                      </span>
                    </CellLink>
                  </td>

                  {/* How much intelligence exists for this fixture. */}
                  <td className="px-2 py-2 text-center align-middle">
                    <CellLink href={href}>
                      <span className="mono tnum text-[0.78rem] font-semibold text-text">
                        {firing}
                        <span className="text-[0.62rem] text-faint">/{MODULES.length}</span>
                      </span>
                    </CellLink>
                  </td>

                  {/* How strongly it agrees. */}
                  <td className="px-2 py-2 align-middle">
                    <CellLink href={href}>
                      <span
                        className="mono inline-block rounded px-1.5 py-0.5 text-[0.58rem] font-bold tracking-widest"
                        style={{
                          color: overall.color,
                          background: `color-mix(in srgb, ${overall.color} 15%, transparent)`,
                        }}
                      >
                        {overall.label}
                      </span>
                      <span className="mono mt-0.5 block text-[0.55rem] text-faint">
                        {t.supports}S {t.neutral}N {t.contradicts}C
                      </span>
                    </CellLink>
                  </td>

                  {/* Which side it favours. */}
                  <td className="px-2 py-2 align-middle">
                    <CellLink href={href}>
                      <span
                        className="mono block truncate text-[0.72rem] font-semibold"
                        style={{ color: pickName ? "var(--text)" : "var(--faint)" }}
                      >
                        {pickName ?? "No edge"}
                      </span>
                    </CellLink>
                  </td>
                </tr>
              );
            })}
          </tbody>
        ))}
      </table>
    </div>
  );
}

// ── Date navigation ──────────────────────────────────────
// A strip rather than a dropdown: the days come from the fixtures actually
// present, so it never offers an empty date, and changing the axis this page is
// organised around should not need a menu opened first. Links, so it works
// without JavaScript and is shareable.

export interface DayOption {
  /** YYYY-MM-DD, the value carried in ?date= */
  key: string;
  label: string;
  count: number;
  isToday: boolean;
}

export function dayKeyOf(date: string | Date): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

export function buildDayOptions(entries: FeedEntry[]): DayOption[] {
  const today = dayKeyOf(new Date());
  const counts = new Map<string, number>();
  for (const e of entries) {
    const k = dayKeyOf(e.match.date);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => {
      const d = new Date(`${key}T12:00:00`);
      return {
        key,
        count,
        isToday: key === today,
        label:
          key === today
            ? "Today"
            : d.toLocaleDateString(undefined, {
                weekday: "short",
                day: "numeric",
                month: "short",
              }),
      };
    });
}

export function DateNav({
  days,
  active,
  total,
  basePath = "/matches",
  extraParams = {},
}: {
  days: DayOption[];
  active: string | null;
  total: number;
  basePath?: string;
  /** Carried through every chip so ?sort= and ?module= survive a date change. */
  extraParams?: Record<string, string>;
}) {
  if (days.length === 0) return null;
  const hrefFor = (date?: string) => {
    const qs = new URLSearchParams(extraParams);
    if (date) qs.set("date", date);
    const q = qs.toString();
    return q ? `${basePath}?${q}` : basePath;
  };
  const chip = (href: string, label: string, count: number, on: boolean) => (
    <Link
      key={href}
      href={href}
      className="mono shrink-0 rounded-term px-2.5 py-1.5 text-[0.62rem] tracking-wide transition-colors"
      style={{
        color: on ? "var(--ink)" : "var(--muted)",
        background: on ? "var(--amber)" : "transparent",
        border: `1px solid ${on ? "var(--amber)" : "var(--line)"}`,
      }}
    >
      {label}
      <span className={`ml-1.5 tnum ${on ? "opacity-70" : "text-faint"}`}>{count}</span>
    </Link>
  );
  return (
    <nav
      aria-label="Match day"
      className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {chip(hrefFor(), "All", total, active == null)}
      {days.map((d) => chip(hrefFor(d.key), d.label, d.count, active === d.key))}
    </nav>
  );
}
