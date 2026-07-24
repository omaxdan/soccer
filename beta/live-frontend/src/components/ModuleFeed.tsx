// ─────────────────────────────────────────────────────────────────────────────
// ModuleFeed — the dashboard.
//
// This is not a fixture list. A fixture appears BECAUSE modules fired for it,
// and the row leads with which ones fired, not with the teams.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import Link from "next/link";
import {
  evaluateMatchModules,
  derivePickSide,
  tally,
  overallVerdict,
} from "@/lib/modules";
import type { MatchRow, BankerSingle } from "@/lib/types";
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
      form_index: single.home_form,
    },
    awayIntel: {
      ...(m.awayIntel ?? ({ team_id: m.away.id } as any)),
      form_index: single.away_form,
    },
    home_form: single.home_form_string ?? m.home_form,
    away_form: single.away_form_string ?? m.away_form,
  };
}

export function ModuleFeedRow({
  match,
  single,
  viewer,
}: {
  match: MatchRow;
  single?: BankerSingle;
  viewer: Tier;
}) {
  const m = withCardForm(match, single);
  const readings = evaluateMatchModules({ match: m, pickSide: derivePickSide(m) });
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
  matches,
  singles,
  viewer,
}: {
  matches: MatchRow[];
  singles: BankerSingle[];
  viewer: Tier;
}) {
  const byMatch = new Map(singles.map((s) => [s.match_id, s]));
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {matches.map((m) => (
        <ModuleFeedRow key={m.id} match={m} single={byMatch.get(m.id)} viewer={viewer} />
      ))}
    </div>
  );
}
