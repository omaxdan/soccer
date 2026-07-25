// ─────────────────────────────────────────────────────────────────────────────
// ModuleFeed — the dashboard.
//
// This is not a fixture list. A fixture appears BECAUSE modules fired for it,
// and the row leads with which ones fired, not with the teams.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import Link from "next/link";
import {
  evaluateAllMatchModules,
  derivePickSide,
  tally,
  overallVerdict,
} from "@/lib/modules";
import type { MatchRow, BankerSingle } from "@/lib/types";
import type { ModuleKey, ModuleReading } from "@/lib/modules";
import { canSee, type Tier } from "@/lib/tier";
import { Crest } from "./Crest";
import { ModuleChip } from "./ModuleCard";
import { kickoff } from "@/lib/intel";
import { matchSlug } from "@/lib/slug";
import { IconArrowRight } from "./icons/ModuleIcons";

/**
 * The board query does not carry per-team form_index, but the betting card
 * does. Graft it on so Module 8 can fire in the feed without a new fetch.
 */
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

/** Evaluate every board fixture once. Shared by the feed and its filter. */
export function buildFeed(matches: MatchRow[], singles: BankerSingle[]): FeedEntry[] {
  const byMatch = new Map(singles.map((s) => [s.match_id, s]));
  return matches.map((match) => {
    const m = withCardForm(match, byMatch.get(match.id));
    const pickSide = derivePickSide(m);
    // Same twelve-module context the match page builds, so the feed, the
    // filter chip and the fixture's own report can never disagree about
    // whether a module fired.
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

/** Entries where the given module actually produced a reading. */
export function filterFeed(entries: FeedEntry[], key: ModuleKey | null): FeedEntry[] {
  if (!key) return entries;
  return entries.filter((e) =>
    e.readings.some((r) => r.def.key === key && r.status !== "inactive")
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
  const readings = entry.readings;
  const firing = readings.filter((r) => r.status !== "inactive");
  const t = tally(readings);
  const overall = overallVerdict(t);
  const k = kickoff(m.date);

  if (firing.length === 0) return null;

  return (
    <article className="panel p-3.5 transition-colors hover:border-[color-mix(in_srgb,var(--amber)_28%,var(--line))]">
      {/* Line 1 — verdict, competition, kickoff */}
      <div className="flex items-center gap-2">
        <span
          className="mono rounded px-1.5 py-0.5 text-[0.55rem] font-bold tracking-widest"
          style={{
            color: overall.color,
            background: `color-mix(in srgb, ${overall.color} 13%, transparent)`,
          }}
        >
          {overall.label}
        </span>
        <span className="mono truncate text-[0.62rem] tracking-wide text-muted">
          {m.competition ?? m.tournament?.name ?? "—"}
        </span>
        <span className="mono ml-auto shrink-0 text-[0.62rem] tabular-nums text-faint">
          {k.day} · {k.time}
        </span>
      </div>

      {/* Line 2 — the fixture */}
      <Link
        href={`/match/${matchSlug(m)}`}
        className="mt-2 flex items-center gap-2.5"
      >
        <Crest team={m.home} size={22} />
        <span className="mono truncate text-[0.82rem] font-semibold text-text">
          {m.home.short_name || m.home.name}
        </span>
        <span className="mono text-[0.65rem] text-faint">v</span>
        <span className="mono truncate text-[0.82rem] font-semibold text-text">
          {m.away.short_name || m.away.name}
        </span>
        <Crest team={m.away} size={22} />
      </Link>

      {/* Line 3 — which modules fired */}
      <div className="mt-2.5">
        <div className="label-cap mb-1.5">
          Modules firing · {t.supports} support · {t.neutral} neutral ·{" "}
          <span style={{ color: t.contradicts ? "var(--risk)" : "var(--faint)" }}>
            {t.contradicts} contradict
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {firing.map((r) => (
            <ModuleChip
              key={r.def.key}
              def={r.def}
              status={r.status}
              detail={canSee(r.def, viewer) ? r.headline.split("·")[0].trim() : undefined}
              locked={!canSee(r.def, viewer)}
            />
          ))}
        </div>
      </div>

      <Link
        href={`/match/${matchSlug(m)}`}
        className="mono mt-3 inline-flex items-center gap-1.5 text-[0.62rem] tracking-widest text-amber"
      >
        OPEN MODULE REPORT
        <IconArrowRight size={12} />
      </Link>
    </article>
  );
}

export function ModuleFeed({
  entries,
  viewer,
}: {
  entries: FeedEntry[];
  viewer: Tier;
}) {
  if (entries.length === 0) {
    return (
      <div className="panel p-5 text-center">
        <p className="mono text-[0.72rem] text-muted">No fixture in the window fires this module.</p>
        <p className="mt-1 text-[0.66rem] text-faint">
          The module&rsquo;s view may still hold rows for fixtures outside the board window.
        </p>
      </div>
    );
  }
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {entries.map((e) => (
        <ModuleFeedRow key={e.match.id} entry={e} viewer={viewer} />
      ))}
    </div>
  );
}
