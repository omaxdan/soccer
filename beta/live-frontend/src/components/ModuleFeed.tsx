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
  type ModuleKey,
  type ModuleReading,
} from "@/lib/modules";
import type { MatchRow, BankerSingle } from "@/lib/types";
import type { Tier } from "@/lib/tier";
import { FeedTable } from "./FeedTable";

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

export function buildFeed(
  matches: MatchRow[],
  singles: BankerSingle[],
  bandBacktests?: Record<string, { rate: number; sample: number; isCalibrated: boolean }> | null
): FeedEntry[] {
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
        {
          match: m,
          pickSide,
          scoring: m.scoring ?? null,
          travel: m.travel ?? null,
          bandBacktests: bandBacktests ?? null,
        },
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

// ── Feed ─────────────────────────────────────────────────
// Rendering lives in FeedTable; this keeps the ordering so the sort means the
// same thing for fixtures and for the groups they sit in.

export function sortEntries(entries: FeedEntry[], sort: FeedSort): FeedEntry[] {
  return [...entries].sort((a, b) => sortValue(a, sort) - sortValue(b, sort));
}

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
  return <FeedTable entries={sortEntries(entries, sort)} viewer={viewer} groupBy="league" />;
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
    `/app?sort=${s}${moduleParam ? `&module=${moduleParam}` : ""}`;
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
