// ─────────────────────────────────────────────────────────────────────────────
// ModuleReport — the body of /match/[slug].
//
// One scrollable report of which of the twelve modules fired for this fixture:
// eight match-scope, plus the four team-scope modules rendered head-to-head.
//
// Team-scope modules are shown for context but excluded from consensus. A
// permanently home-reliant side would otherwise cast the same vote every week
// regardless of who it was playing.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import {
  evaluateAllMatchModules,
  derivePickSide,
  tally,
  overallVerdict,
  isInformational,
  MODULES,
  type ModuleReading,
  type MatchTeamSides,
} from "@/lib/modules";
import type { MatchRow, MatchScoringProbabilities, LeagueGapSummary } from "@/lib/types";
import type { Tier } from "@/lib/tier";
import { ModuleCard, ModuleVerdictSummary } from "./ModuleCard";
import { IconGate, IconInactive } from "./icons/ModuleIcons";

function narrative(readings: ModuleReading[], match: MatchRow): string {
  const scoring = readings.filter((r) => !isInformational(r.def));
  const supports = scoring.filter((r) => r.status === "supports");
  const against = scoring.filter((r) => r.status === "contradicts");
  const home = match.home.short_name || match.home.name;
  const away = match.away.short_name || match.away.name;
  const pick = derivePickSide(match);
  const side = pick === "home" ? home : pick === "away" ? away : null;

  if (scoring.every((r) => r.status === "inactive"))
    return "No match-level module produced a reading for this fixture. There is nothing here to act on.";

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

  // Team-scope context is assembled from data getMatch already returns.
  const sides: MatchTeamSides = {
    homeName: match.home.short_name || match.home.name,
    awayName: match.away.short_name || match.away.name,
    pickSide,
    home: {
      intel: match.homeIntel ?? null,
      formQuality: match.homeFormQuality ?? null,
      venue: match.homeVenue ?? null,
      momentum: null,
    },
    away: {
      intel: match.awayIntel ?? null,
      formQuality: match.awayFormQuality ?? null,
      venue: match.awayVenue ?? null,
      momentum: null,
    },
  };

  const readings = evaluateAllMatchModules(
    { match, pickSide, scoring, leagueGap },
    sides
  );
  const active = showInactive ? readings : readings.filter((r) => r.status !== "inactive");
  const dormant = readings.filter((r) => r.status === "inactive");
  const firing = readings.filter((r) => r.status !== "inactive").length;
  const t = tally(readings);
  const overall = overallVerdict(t);

  return (
    <div className="space-y-4">
      {/* Report bar */}
      <div className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
        <div>
          <div className="label-cap">Modules firing</div>
          <div className="mono tnum text-lg font-semibold text-text">
            {firing}
            <span className="text-sm text-faint">/{MODULES.length}</span>
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
              ? sides.homeName
              : pickSide === "away"
                ? sides.awayName
                : "None"}
          </div>
        </div>
        <p className="ml-auto flex max-w-xs items-start gap-2 text-[0.65rem] leading-relaxed text-faint">
          <span className="mt-px text-faint">
            <IconGate size={13} />
          </span>
          Consensus counts the eight match-level modules only, and is capped by any
          contradiction. Two disagreements force WEAK.
        </p>
      </div>

      {/* Firing modules — supports, then neutral, then contradicts */}
      <div className="grid gap-3 lg:grid-cols-2">
        {active.map((r) => (
          <ModuleCard key={r.def.key} reading={r} viewer={viewer} />
        ))}
      </div>

      {/* Verdict summary */}
      <ModuleVerdictSummary readings={readings} narrative={narrative(readings, match)} />

      {/* Dormant modules — always listed, always with a reason */}
      {!showInactive && dormant.length > 0 && (
        <section className="panel p-4">
          <h2 className="mono mb-2.5 flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-muted">
            <IconInactive size={13} />
            Did not fire ({dormant.length})
          </h2>
          <ul className="space-y-1.5">
            {dormant.map((r) => (
              <li key={r.def.key} className="text-[0.7rem] leading-relaxed">
                <span className="mono font-semibold text-muted">
                  M{r.def.n} {r.def.name}
                </span>
                <span className="text-faint"> — {r.headline}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
