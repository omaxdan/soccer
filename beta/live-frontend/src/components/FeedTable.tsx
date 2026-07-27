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
import { tally, overallVerdict, derivePickSide } from "@/lib/modules";
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
  // Country prefixes the competition so the board reads as a hierarchy rather
  // than a flat list of league names. Both /app and /matches call this, so the
  // two cannot drift into separate organisation schemes.
  const league = e.match.competition ?? e.match.tournament?.name ?? "Other";
  const c = e.match.tournament?.country;
  const country = typeof c === "string" ? c : (c as { name?: string } | null)?.name ?? null;
  return country ? `${country} · ${league}` : league;
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

/**
 * Home above away is already the row's ordering, so the H/A letters were
 * spending a column's worth of width restating it. The slot now carries the
 * score where one exists, and a dash where the fixture is still ahead.
 */
function TeamLine({ team, score }: { team: MatchRow["home"]; score: number | null }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Crest team={team} size={15} />
      <span className="mono truncate text-[0.7rem] font-semibold text-text md:text-[0.76rem]">
        {team.short_name || team.name}
      </span>
      <span
        className="mono tnum ml-auto shrink-0 text-[0.72rem] font-semibold"
        style={{ color: score == null ? "var(--faint)" : "var(--text)" }}
      >
        {score ?? "–"}
      </span>
    </span>
  );
}

export function FeedTable({
  entries,
  viewer: _viewer,
  groupBy = "league",
}: {
  entries: FeedEntry[];
  viewer: Tier;
  groupBy?: FeedGrouping;
}) {
  const groups = new Map<string, FeedEntry[]>();
  for (const e of entries) {
    const key = groupLabel(e, groupBy);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  // No sticky header and no internal scroll container: the board should read
  // as a feed that flows with the page, not a spreadsheet with its own
  // viewport. Removing the scroll container also removes the reason the header
  // had to stick in the first place.
  const head = "whitespace-nowrap px-2 py-2 text-left font-normal";

  return (
    <div className="panel">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-line">
            <th className={head}>
              <span className="label-cap">Time</span>
            </th>
            {groupBy === "day" && (
              <th className={`${head} hidden md:table-cell`}>
                <span className="label-cap">Competition</span>
              </th>
            )}
            <th className={head}>
              <span className="label-cap">Fixture</span>
            </th>
            <th className={head}>
              <span className="label-cap">Historical advantage</span>
            </th>
          </tr>
        </thead>

        {[...groups.entries()].map(([label, list]) => (
          <tbody key={label}>
            <tr>
              <td
                colSpan={groupBy === "day" ? 4 : 3}
                className="mono border-y border-line bg-raised px-2 py-1 text-[0.6rem] uppercase tracking-[0.14em] text-muted"
              >
                {label}
                <span className="ml-2 tnum text-faint">{list.length}</span>
              </td>
            </tr>

            {list.map((e) => {
              const m = e.match;
              const k = kickoff(m.date);
              const overall = overallVerdict(tally(e.readings));
              const pickSide = derivePickSide(m);
              const advantageName =
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
                        <TeamLine team={m.home} score={m.home_score ?? null} />
                        <TeamLine team={m.away} score={m.away_score ?? null} />
                      </span>
                    </CellLink>
                  </td>

                  {/* Modules firing, the S/N/C counts and the consensus label
                      used to be three columns. They exposed evaluator mechanics
                      and made the board read as diagnostics; the strength
                      classification carries the same meaning without them.
                      The detail stays inside the match report. */}
                  <td className="px-2 py-2 align-middle">
                    <CellLink href={href}>
                      <span
                        className="mono block truncate text-[0.76rem] font-semibold"
                        style={{ color: advantageName ? "var(--text)" : "var(--faint)" }}
                      >
                        {advantageName ?? "No edge"}
                      </span>
                      {advantageName && (
                        <span
                          className="mono mt-0.5 block text-[0.55rem] font-bold tracking-widest"
                          style={{ color: overall.color }}
                        >
                          {overall.label}
                        </span>
                      )}
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
  showAll = true,
}: {
  days: DayOption[];
  active: string | null;
  total: number;
  basePath?: string;
  /** Carried through every chip so ?sort= and ?module= survive a date change. */
  extraParams?: Record<string, string>;
  /**
   * "All" is hidden when the board is limited: it would promise the whole
   * fixture list and then deliver a capped one, which reads as a bug rather
   * than a tier.
   */
  showAll?: boolean;
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
      {showAll && chip(hrefFor(), "All", total, active == null)}
      {days.map((d) => chip(hrefFor(d.key), d.label, d.count, active === d.key))}
    </nav>
  );
}
