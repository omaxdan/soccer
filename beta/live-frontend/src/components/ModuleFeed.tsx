// ─────────────────────────────────────────────────────────────────────────────
// ModuleFeed — the dashboard, as a compact pill grid.
//
// One row per fixture: kickoff, the two sides, thirteen status pills, and the
// consensus badge. Mobile first — the pill grid is sized so all thirteen fit
// a 375px viewport without wrapping (13 × 18px + 12 × 4px = 282px inside a
// ~343px content box) and simply stay on one line as the screen widens.
//
// Expand/collapse is a native <details>, so the whole feed stays a server
// component and works with JavaScript off. Team names remain real links; the
// rest of the card toggles.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import Link from "next/link";
import {
  evaluateAllMatchModules,
  derivePickSide,
  tally,
  overallVerdict,
  statusColor,
  MODULES,
  type ModuleKey,
  type ModuleReading,
  type ModuleStatus,
} from "@/lib/modules";
import type { MatchRow, BankerSingle } from "@/lib/types";
import { canSee, type Tier } from "@/lib/tier";
import { Crest } from "./Crest";
import { ModuleCard } from "./ModuleCard";
import { kickoff } from "@/lib/intel";
import { matchSlug, teamSlug } from "@/lib/slug";

// ── Sorting ──────────────────────────────────────────────

export type FeedSort = "consensus" | "kickoff" | "confidence";

export const SORT_OPTIONS: { key: FeedSort; label: string }[] = [
  { key: "consensus", label: "Consensus" },
  { key: "kickoff", label: "Kickoff" },
  { key: "confidence", label: "Confidence" },
];

export function parseSort(raw: string | undefined): FeedSort {
  return SORT_OPTIONS.some((o) => o.key === raw) ? (raw as FeedSort) : "consensus";
}

const CONSENSUS_RANK: Record<string, number> = {
  STRONG: 0,
  MODERATE: 1,
  NEUTRAL: 2,
  WEAK: 3,
  "NO READ": 4,
};

// ── Feed construction ────────────────────────────────────

function withCardForm(m: MatchRow, single: BankerSingle | undefined): MatchRow {
  if (!single) return m;
  return {
    ...m,
    homeIntel: {
      ...(m.homeIntel ?? ({ team_id: m.home.id } as any)),
      form_index: m.homeIntel?.form_index ?? single.home_form,
    },
    awayIntel: {
      ...(m.awayIntel ?? ({ team_id: m.away.id } as any)),
      form_index: m.awayIntel?.form_index ?? single.away_form,
    },
    home_form: m.home_form ?? single.home_form_string,
    away_form: m.away_form ?? single.away_form_string,
  };
}

export interface FeedEntry {
  match: MatchRow;
  readings: ModuleReading[];
}

export function buildFeed(matches: MatchRow[], singles: BankerSingle[]): FeedEntry[] {
  const byMatch = new Map(singles.map((s) => [s.match_id, s]));
  return matches.map((match) => {
    const m = withCardForm(match, byMatch.get(match.id));
    const pickSide = derivePickSide(m);
    const sides = {
      homeName: m.home.short_name || m.home.name,
      awayName: m.away.short_name || m.away.name,
      pickSide,
      home: {
        intel: m.homeIntel ?? null,
        formQuality: m.homeFormQuality ?? null,
        venue: m.homeVenue ?? null,
        momentum: null,
      },
      away: {
        intel: m.awayIntel ?? null,
        formQuality: m.awayFormQuality ?? null,
        venue: m.awayVenue ?? null,
        momentum: null,
      },
    };
    return {
      match: m,
      readings: evaluateAllMatchModules(
        { match: m, pickSide, scoring: m.scoring ?? null, travel: m.travel ?? null },
        sides
      ),
    };
  });
}

export function filterFeed(entries: FeedEntry[], key: ModuleKey | null): FeedEntry[] {
  if (!key) return entries;
  return entries.filter((e) =>
    e.readings.some((r) => r.def.key === key && r.status !== "inactive")
  );
}

function sortValue(e: FeedEntry, sort: FeedSort): number {
  if (sort === "kickoff") return new Date(e.match.date).getTime();
  if (sort === "confidence") return -(e.match.intel?.confidence_score ?? -1);
  return CONSENSUS_RANK[overallVerdict(tally(e.readings)).label] ?? 9;
}

// ── Pills ────────────────────────────────────────────────

function pillStyle(status: ModuleStatus | null, locked: boolean) {
  if (locked || status == null || status === "inactive") {
    return {
      color: "var(--faint)",
      background: "color-mix(in srgb, var(--line) 50%, transparent)",
      border: "1px solid transparent",
    };
  }
  const c = statusColor(status);
  return {
    color: c,
    background: `color-mix(in srgb, ${c} 15%, transparent)`,
    border: `1px solid color-mix(in srgb, ${c} 35%, transparent)`,
  };
}

function PillRow({
  readings,
  viewer,
}: {
  readings: ModuleReading[];
  viewer: Tier;
}) {
  const byKey = new Map(readings.map((r) => [r.def.key, r]));
  return (
    <div className="flex flex-wrap gap-1" aria-label="Module status">
      {MODULES.map((def) => {
        const r = byKey.get(def.key) ?? null;
        const locked = !canSee(def, viewer);
        const fired = r != null && r.status !== "inactive";
        return (
          <span
            key={def.key}
            title={`M${def.n} ${def.name}${r ? ` — ${r.status}` : ""}`}
            className="mono inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[7px] font-bold leading-none tracking-tight"
            style={pillStyle(r?.status ?? null, locked)}
          >
            {fired && !locked ? def.abbrev : "—"}
          </span>
        );
      })}
    </div>
  );
}

// ── Row ──────────────────────────────────────────────────

function TeamLine({ team }: { team: MatchRow["home"] }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Crest team={team} size={20} />
      <Link
        href={`/team/${teamSlug(team)}`}
        className="mono truncate text-[0.78rem] font-semibold text-text transition-colors hover:text-amber"
      >
        <span className="md:hidden">{team.short_name || team.name}</span>
        <span className="hidden md:inline">{team.name}</span>
      </Link>
    </span>
  );
}

export function ModuleFeedRow({
  entry,
  viewer,
}: {
  entry: FeedEntry;
  viewer: Tier;
}) {
  const m = entry.match;
  const t = tally(entry.readings);
  const overall = overallVerdict(t);
  const k = kickoff(m.date);
  const active = entry.readings.filter((r) => r.status !== "inactive");

  return (
    <details className="panel group overflow-hidden transition-colors hover:bg-raised">
      <summary className="flex cursor-pointer list-none flex-col gap-2 p-3 [&::-webkit-details-marker]:hidden">
        {/* Kickoff + the two sides */}
        <div className="flex items-start gap-3">
          <span className="mono flex shrink-0 flex-col text-[0.7rem] leading-tight text-muted md:flex-row md:gap-1.5">
            <span className="tnum text-text">{k.time}</span>
            <span className="text-faint">{k.day}</span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-2.5">
            <TeamLine team={m.home} />
            <TeamLine team={m.away} />
          </span>
          <Link
            href={`/match/${matchSlug(m)}`}
            className="mono shrink-0 self-center rounded-term px-2 py-1 text-[0.58rem] tracking-widest text-faint transition-colors hover:text-amber"
            aria-label="Open full match report"
          >
            REPORT
          </Link>
        </div>

        {/* Pills + consensus */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <PillRow readings={entry.readings} viewer={viewer} />
          <span
            className="mono ml-auto shrink-0 rounded px-1.5 py-0.5 text-[0.58rem] font-bold tracking-widest"
            style={{
              color: overall.color,
              background: `color-mix(in srgb, ${overall.color} 15%, transparent)`,
            }}
          >
            {overall.label} · {t.supports}S {t.neutral}N {t.contradicts}C
          </span>
        </div>
      </summary>

      {/* Expanded module detail */}
      <div className="border-t border-line p-3">
        <div className="grid gap-3 lg:grid-cols-2">
          {active.map((r) => (
            <ModuleCard key={r.def.key} reading={r} viewer={viewer} />
          ))}
        </div>
      </div>
    </details>
  );
}

// ── Feed ─────────────────────────────────────────────────

export function ModuleFeed({
  entries,
  viewer,
  sort = "consensus",
}: {
  entries: FeedEntry[];
  viewer: Tier;
  sort?: FeedSort;
}) {
  if (entries.length === 0) {
    return (
      <div className="panel p-5 text-center">
        <p className="mono text-[0.72rem] text-muted">
          No fixture in the window fires this module.
        </p>
        <p className="mt-1 text-[0.66rem] text-faint">
          The module&rsquo;s view may still hold rows for fixtures outside the board window.
        </p>
      </div>
    );
  }

  // Group by competition, then apply the chosen sort inside each group and to
  // the groups themselves, so the ordering means the same thing at both levels.
  const groups = new Map<string, FeedEntry[]>();
  for (const e of entries) {
    const league = e.match.competition ?? e.match.tournament?.name ?? "Other";
    groups.set(league, [...(groups.get(league) ?? []), e]);
  }

  const ordered = [...groups.entries()]
    .map(([league, list]) => ({
      league,
      list: [...list].sort((a, b) => sortValue(a, sort) - sortValue(b, sort)),
    }))
    .sort((a, b) => sortValue(a.list[0], sort) - sortValue(b.list[0], sort));

  return (
    <div className="space-y-5">
      {ordered.map(({ league, list }) => (
        <section key={league}>
          <h3 className="mono mb-2 border-b border-line pb-1.5 text-[0.62rem] uppercase tracking-[0.14em] text-muted">
            {league}
            <span className="ml-2 tnum text-faint">{list.length}</span>
          </h3>
          <div className="space-y-2">
            {list.map((e) => (
              <ModuleFeedRow key={e.match.id} entry={e} viewer={viewer} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Sort control ─────────────────────────────────────────
// A <details> dropdown of links: no client JavaScript, and the chosen sort
// lives in the URL so it survives a refresh and can be shared.

export function SortControl({
  current,
  moduleParam,
}: {
  current: FeedSort;
  moduleParam?: string;
}) {
  const href = (s: FeedSort) =>
    `/?sort=${s}${moduleParam ? `&module=${moduleParam}` : ""}`;
  const label = SORT_OPTIONS.find((o) => o.key === current)?.label ?? "Consensus";
  return (
    <details className="relative">
      <summary className="mono flex cursor-pointer list-none items-center gap-1.5 text-[0.6rem] tracking-widest text-faint transition-colors hover:text-text [&::-webkit-details-marker]:hidden">
        SORTED BY {label.toUpperCase()}
        <span aria-hidden="true">▾</span>
      </summary>
      <ul className="panel absolute right-0 z-20 mt-1 min-w-[9rem] p-1">
        {SORT_OPTIONS.map((o) => (
          <li key={o.key}>
            <Link
              href={href(o.key)}
              className="mono block rounded-term px-2 py-1.5 text-[0.65rem] transition-colors hover:bg-raised"
              style={{ color: o.key === current ? "var(--amber)" : "var(--muted)" }}
            >
              {o.label}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
