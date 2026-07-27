// ─────────────────────────────────────────────────────────────────────────────
// FeedTable — the board and fixtures list as a high-level intelligence board.
//
// Was thirteen module columns per fixture, two rows deep, on a both-axis
// scroller with sticky edges. That asked a reader to learn thirteen
// abbreviations and scan a grid to answer one question. Now three fields:
// how much intelligence exists, how strongly it agrees, and which side it
// favours. The per-module breakdown lives on the match page.
//
// One responsive grid rather than a table plus a mobile variant: the same
// markup reads as aligned columns from md up and stacks into a card below it,
// so there is nothing to keep in sync and no horizontal scroll at any width.
//
// No calculation changed. tally() and overallVerdict() are the same functions
// the match page uses; derivePickSide() is unchanged.
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

/** Fraction of modules firing, used to shade the count. */
function coverageColor(firing: number, total: number): string {
  const r = firing / total;
  if (r >= 0.8) return "var(--edge)";
  if (r >= 0.5) return "var(--warn)";
  return "var(--muted)";
}

function TeamLine({ team }: { team: MatchRow["home"] }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Crest team={team} size={18} />
      <span className="mono truncate text-[0.76rem] font-semibold text-text">
        {team.short_name || team.name}
      </span>
    </span>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`flex flex-col gap-0.5 ${className}`}>
      {/* Labels show on the stacked card and are redundant under the desktop
          header row, so they hide from md up. */}
      <span className="label-cap md:hidden">{label}</span>
      {children}
    </span>
  );
}

const ROW_GRID =
  "grid grid-cols-2 gap-x-4 gap-y-2 md:grid-cols-[4.5rem_minmax(0,1fr)_5.5rem_7rem_8rem] md:items-center md:gap-y-0";

function FeedRow({ entry }: { entry: FeedEntry }) {
  const m = entry.match;
  const k = kickoff(m.date);
  const t = tally(entry.readings);
  const overall = overallVerdict(t);
  const firing = entry.readings.filter((r) => r.status !== "inactive").length;
  const pickSide = derivePickSide(m);

  const pick =
    pickSide === "home"
      ? m.home.short_name || m.home.name
      : pickSide === "away"
        ? m.away.short_name || m.away.name
        : t.firing === 0
          ? "No edge"
          : "Draw lean";

  return (
    <Link
      href={`/match/${matchSlug(m)}`}
      className={`${ROW_GRID} border-t border-line px-3 py-3 transition-colors first:border-t-0 hover:bg-raised`}
    >
      <Field label="Kickoff" className="col-span-2 md:col-span-1">
        <span className="mono text-[0.72rem] leading-tight">
          <span className="tnum text-text">{k.time}</span>{" "}
          <span className="text-faint">{k.day}</span>
        </span>
      </Field>

      <Field label="Fixture" className="col-span-2 md:col-span-1">
        <span className="flex min-w-0 flex-col gap-1">
          <TeamLine team={m.home} />
          <TeamLine team={m.away} />
        </span>
      </Field>

      <Field label="Modules">
        <span
          className="mono tnum text-[0.78rem] font-semibold"
          style={{ color: coverageColor(firing, MODULES.length) }}
        >
          {firing}
          <span className="text-faint"> / {MODULES.length}</span>
        </span>
      </Field>

      <Field label="Consensus">
        <span
          className="mono w-fit rounded px-1.5 py-0.5 text-[0.6rem] font-bold tracking-widest"
          style={{
            color: overall.color,
            background: `color-mix(in srgb, ${overall.color} 14%, transparent)`,
          }}
        >
          {overall.label}
        </span>
      </Field>

      <Field label="Favours">
        <span className="mono truncate text-[0.74rem] font-semibold text-text">{pick}</span>
      </Field>
    </Link>
  );
}

export function FeedTable({
  entries,
  groupBy = "league",
}: {
  entries: FeedEntry[];
  /** Unused now the grid is self-sizing; kept so callers need not change. */
  viewer?: Tier;
  groupBy?: FeedGrouping;
  maxHeight?: string;
}) {
  const groups = new Map<string, FeedEntry[]>();
  for (const e of entries) {
    const key = groupLabel(e, groupBy);
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([label, list]) => (
        <section key={label}>
          <h3 className="mono mb-1.5 flex items-baseline gap-2 text-[0.62rem] uppercase tracking-[0.14em] text-muted">
            {label}
            <span className="tnum text-faint">{list.length}</span>
          </h3>

          {/* Header row, desktop only — the stacked card labels each field. */}
          <div className={`${ROW_GRID} hidden px-3 pb-1 md:grid`}>
            <span className="label-cap">Kickoff</span>
            <span className="label-cap">Fixture</span>
            <span className="label-cap">Modules</span>
            <span className="label-cap">Consensus</span>
            <span className="label-cap">Favours</span>
          </div>

          <div className="panel divide-y divide-line">
            {list.map((e) => (
              <FeedRow key={e.match.id} entry={e} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Date navigation ──────────────────────────────────────

export interface DayOption {
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
