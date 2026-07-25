// ─────────────────────────────────────────────────────────────────────────────
// ModuleReport — the body of /match/[slug].
//
// All thirteen modules count toward consensus now, team-scope included. The
// team modules on this page are two-sided: each compares the home side's
// profile against the away side's and judges relative to the pick, so they
// describe THIS fixture rather than restating a season-long habit.
//
// Readings are built by the page and passed in, so the match story can be
// written from the same verdicts the cards show instead of re-deriving them
// from raw columns — that duplication is what made the story contradict M1.
// ─────────────────────────────────────────────────────────────────────────────

import React from "react";
import {
  evaluateAllMatchModules,
  derivePickSide,
  tally,
  overallVerdict,
  MODULES,
  type ModuleReading,
  type MatchTeamSides,
} from "@/lib/modules";
import type { MatchRow, MatchScoringProbabilities, LeagueGapSummary } from "@/lib/types";
import { ModuleVerdictSummary } from "./ModuleCard";
import { IconGate, IconUnverified } from "./icons/ModuleIcons";

/** Team-scope context assembled from data getMatch already returns. */
export function matchTeamSides(match: MatchRow): MatchTeamSides {
  return {
    homeName: match.home.short_name || match.home.name,
    awayName: match.away.short_name || match.away.name,
    pickSide: derivePickSide(match),
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
}

/** Single evaluation point for a fixture. Call once, share the result. */
export function buildMatchReadings(
  match: MatchRow,
  scoring?: MatchScoringProbabilities | null,
  leagueGap?: LeagueGapSummary | null
): ModuleReading[] {
  return evaluateAllMatchModules(
    {
      match,
      pickSide: derivePickSide(match),
      scoring: scoring ?? match.scoring ?? null,
      leagueGap,
      travel: match.travel ?? null,
    },
    matchTeamSides(match)
  );
}

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
  readings,
  report,
}: {
  match: MatchRow;
  readings: ModuleReading[];
  /**
   * The full match report, rendered between the data gaps and the verdict
   * summary. The per-module cards this component used to render are gone —
   * the report carries the same readings in a denser form, and showing both
   * meant every module appeared twice on one page.
   */
  report?: React.ReactNode;
}) {
  const pickSide = derivePickSide(match);
  const sides = matchTeamSides(match);
  const active = readings.filter((r) => r.status !== "inactive");
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
            {active.length}
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
          One disagreement caps consensus at MODERATE. Two disagreements force WEAK.
        </p>
      </div>

      {/* Data gaps, surfaced before the report */}
      {dormant.length > 0 && (
        <section
          className="panel p-4"
          style={{ borderColor: "color-mix(in srgb, var(--warn) 28%, var(--line))" }}
        >
          <h2
            className="mono mb-2.5 flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.14em]"
            style={{ color: "var(--warn)" }}
          >
            <IconUnverified size={14} />
            Did not fire ({dormant.length})
          </h2>
          <ul className="space-y-1.5">
            {dormant.map((r) => (
              <li key={r.def.key} className="flex items-start gap-2 text-[0.7rem] leading-relaxed">
                <span className="mt-0.5 shrink-0" style={{ color: "var(--warn)" }}>
                  <IconUnverified size={12} />
                </span>
                <span>
                  <span className="mono font-semibold text-muted">
                    M{r.def.n} {r.def.name}
                  </span>
                  <span className="text-faint"> — {r.headline}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Full match report */}
      {report}

      {/* Verdict summary */}
      <ModuleVerdictSummary readings={readings} narrative={narrative(readings, match)} />
    </div>
  );
}
