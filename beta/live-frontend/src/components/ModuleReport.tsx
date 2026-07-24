// ─────────────────────────────────────────────────────────────────────────────
// ModuleReport — the body of /match/[slug].
//
// Replaces the tab strip. A match page is now a scrollable report of which
// modules fired, ordered so that anything CONTRADICTING the pick surfaces
// first. Burying the disagreeing module below the fold is the single most
// expensive UI mistake this product could make.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import {
  evaluateMatchModules,
  derivePickSide,
  tally,
  overallVerdict,
  type ModuleReading,
} from "@/lib/modules";
import type { MatchRow, MatchScoringProbabilities, LeagueGapSummary } from "@/lib/types";
import type { Tier } from "@/lib/tier";
import { ModuleCard, ModuleVerdictSummary } from "./ModuleCard";
import { IconGate } from "./icons/ModuleIcons";

function narrative(readings: ModuleReading[], match: MatchRow): string {
  const supports = readings.filter((r) => r.status === "supports");
  const against = readings.filter((r) => r.status === "contradicts");
  const home = match.home.short_name || match.home.name;
  const away = match.away.short_name || match.away.name;
  const pick = derivePickSide(match);
  const side = pick === "home" ? home : pick === "away" ? away : null;

  if (readings.every((r) => r.status === "inactive"))
    return "No module produced a reading for this fixture. There is nothing here to act on.";

  const supportText = supports.length
    ? `${supports.map((r) => r.def.name.toLowerCase()).join(", ")} line up ${
        side ? `behind ${side}` : "on the same side"
      }`
    : "no module lines up behind the pick";

  const againstText = against.length
    ? `, but ${against
        .map((r) => r.def.name.toLowerCase())
        .join(" and ")} argue${against.length === 1 ? "s" : ""} the other way`
    : "";

  return `${supportText.charAt(0).toUpperCase()}${supportText.slice(
    1
  )}${againstText}. Read the contradicting modules before the supporting ones.`;
}

export function ModuleReport({
  match,
  scoring,
  leagueGap,
  viewer,
  showInactive = false,
}: {
  match: MatchRow;
  scoring?: MatchScoringProbabilities | null;
  leagueGap?: LeagueGapSummary | null;
  viewer: Tier;
  showInactive?: boolean;
}) {
  const pickSide = derivePickSide(match);
  const readings = evaluateMatchModules({ match, pickSide, scoring, leagueGap });
  const active = showInactive ? readings : readings.filter((r) => r.status !== "inactive");
  const dormant = readings.filter((r) => r.status === "inactive");
  const t = tally(readings);
  const overall = overallVerdict(t);

  return (
    <div className="space-y-4">
      {/* Report bar */}
      <div className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <div>
          <div className="label-cap">Modules firing</div>
          <div className="mono tnum text-lg font-semibold text-text">
            {t.firing}
            <span className="text-sm text-faint">/{readings.length}</span>
          </div>
        </div>
        <div className="h-8 w-px bg-line" />
        <div>
          <div className="label-cap">Module consensus</div>
          <div
            className="mono text-lg font-semibold tracking-tight"
            style={{ color: overall.color }}
          >
            {overall.label}
          </div>
        </div>
        <div className="h-8 w-px bg-line" />
        <div>
          <div className="label-cap">Pick side</div>
          <div className="mono text-lg font-semibold text-text">
            {pickSide === "home"
              ? match.home.short_name || match.home.name
              : pickSide === "away"
              ? match.away.short_name || match.away.name
              : "None"}
          </div>
        </div>
        <p className="ml-auto flex max-w-xs items-start gap-2 text-[0.65rem] leading-relaxed text-faint">
          <span className="mt-px text-faint">
            <IconGate size={13} />
          </span>
          Consensus is capped by any contradicting module. Two disagreements force WEAK
          regardless of how many modules agree.
        </p>
      </div>

      {/* Firing modules */}
      <div className="grid gap-3 lg:grid-cols-2">
        {active.map((r) => (
          <ModuleCard key={r.def.key} reading={r} viewer={viewer} />
        ))}
      </div>

      {/* Verdict summary */}
      <ModuleVerdictSummary readings={readings} narrative={narrative(readings, match)} />

      {/* Dormant modules — listed, never hidden entirely */}
      {!showInactive && dormant.length > 0 && (
        <section className="panel p-4">
          <h2 className="mono mb-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted">
            Did not fire ({dormant.length})
          </h2>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {dormant.map((r) => (
              <li key={r.def.key} className="mono text-[0.68rem] text-faint">
                M{r.def.n} {r.def.name}
                <span className="ml-1.5 opacity-70">— {r.headline}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
