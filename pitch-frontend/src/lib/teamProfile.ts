import type {
  TeamIntelligence, TeamFormQuality, TeamVenuePerformance, TeamGoalDependency,
  TeamBettingIntelligence,
} from "./types";
import type { PerformanceIntel } from "./performance";
import { regressionRisk } from "./performance";

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export interface MarketRead {
  label: string; // Strong / Medium / Low signal
  score: number; // 0..100
  color: string;
}

export interface TeamProfile {
  quality: { overall: number; attack: number; defence: number; squad: number };
  predictability: number;
  volatility: number;
  sustainability: { label: string; regressionRisk: "LOW" | "MEDIUM" | "HIGH"; delta: number | null; reading: string };
  betting: { winner: MarketRead; goals: MarketRead; btts: MarketRead; cards: MarketRead };
  tier: { top: number | null; mid: number | null; bottom: number | null; reading: string } | null;
  bettingIntel: {
    finishing: number | null; shotAccuracy: number | null; conversion: number | null;
    bigChanceConversion: number | null; goalCreation: number | null; goalPrevention: number | null;
    cleanSheet: number | null; source: "precomputed" | "derived";
  };
}

function marketRead(score: number): MarketRead {
  const s = clamp(score);
  if (s >= 66) return { label: "Strong", score: s, color: "var(--edge)" };
  if (s >= 45) return { label: "Medium", score: s, color: "var(--warn)" };
  return { label: "Low signal", score: s, color: "var(--faint)" };
}

const fragToScore = (f: PerformanceIntel["defenseFragility"]) =>
  f === "LOW" ? 76 : f === "MEDIUM" ? 55 : f === "HIGH" ? 34 : null;

export function computeTeamProfile(input: {
  intel: TeamIntelligence | null;
  betting?: TeamBettingIntelligence | null;
  formQuality: TeamFormQuality | null;
  venue: TeamVenuePerformance | null;
  goalDep: TeamGoalDependency | null;
  perf: PerformanceIntel | null;
}): TeamProfile {
  const { intel, betting, formQuality, venue, goalDep, perf } = input;

  // Prefer precomputed team_betting_intelligence ratings; fall back to the
  // runtime performance-engine derivation, then to team_intelligence.
  const attack = betting?.attack_rating ?? perf?.attackEfficiency ?? clamp((intel?.form_index ?? 50));
  const defence = betting?.defence_rating ?? fragToScore(perf?.defenseFragility ?? null) ?? clamp((intel?.squad_stability_score ?? 50));
  const squad = clamp(intel?.squad_depth_score ?? intel?.squad_stability_score ?? 50);
  const overall = betting?.team_quality_score ?? Math.round((attack * 0.4 + defence * 0.35 + squad * 0.25));

  const volatility = clamp(formQuality?.volatility ?? 30);
  const predictability = clamp(100 - volatility);

  // Sustainability from expected vs actual points
  const delta = formQuality?.performance_delta ?? null;
  const rr = regressionRisk(delta);
  const sustainability: TeamProfile["sustainability"] = {
    label: rr.label, regressionRisk: rr.risk, delta, reading: rr.reading,
  };

  // Betting profile — prefer precomputed market scores when available
  const venueAdv = venue?.venue_advantage_score ?? 50;
  const winner = marketRead(betting?.winner_market_score ?? (overall * 0.6 + venueAdv * 0.4));

  const goalsSignal = perf?.signals.find((s) => s.group === "goals");
  const goals = marketRead(betting?.goals_market_score ?? (goalsSignal ? goalsSignal.confidence : attack));

  const bttsSignal = perf?.signals.find((s) => s.group === "btts");
  const btts = marketRead(betting?.btts_score ?? (bttsSignal ? bttsSignal.confidence : 50));

  const cardsScore = perf?.discipline
    ? clamp((4 - (perf.discipline.score ?? 50) / 25) * 25)
    : 30;
  const cards = marketRead(betting?.cards_market_score ?? (perf?.discipline && perf.discipline.tier.includes("risk") ? 70 : cardsScore < 40 ? 30 : cardsScore));

  // Opponent tier (points-per-game vs each tier, 0..3 scale)
  let tier: TeamProfile["tier"] = null;
  if (formQuality && (formQuality.ppg_vs_top != null || formQuality.ppg_vs_bottom != null)) {
    const top = formQuality.ppg_vs_top ?? null;
    const mid = formQuality.ppg_vs_middle ?? null;
    const bottom = formQuality.ppg_vs_bottom ?? null;
    let reading = "";
    if (top != null && bottom != null) {
      if (bottom - top >= 0.8) reading = "Beats up weaker sides but struggles against the top — a flat-track profile.";
      else if (top - bottom >= 0.4) reading = "Raises its level against strong opposition — a genuine giant-killer.";
      else reading = "Performs consistently across opponent quality.";
    }
    tier = { top, mid, bottom, reading };
  }

  // Goal-profile breakdown — precomputed team_betting_intelligence when
  // present, otherwise the performance engine's derived reads.
  const findAttackInsight = (key: string) => perf?.attack.find((a) => a.key === key)?.score ?? null;
  const findDefenseInsight = (key: string) => perf?.defense.find((d) => d.key === key)?.score ?? null;
  const bettingIntel: TeamProfile["bettingIntel"] = betting
    ? {
        finishing: betting.finishing_efficiency, shotAccuracy: betting.shot_accuracy,
        conversion: betting.shot_conversion_rate, bigChanceConversion: betting.big_chance_conversion,
        goalCreation: betting.goal_creation_score, goalPrevention: betting.goal_prevention_score,
        cleanSheet: betting.clean_sheet_reliability, source: "precomputed",
      }
    : {
        finishing: findAttackInsight("finishing"), shotAccuracy: null,
        conversion: findAttackInsight("finishing"), bigChanceConversion: findAttackInsight("big_chance"),
        goalCreation: null, goalPrevention: findDefenseInsight("def_conversion"),
        cleanSheet: findDefenseInsight("clean_sheet"), source: "derived",
      };

  return { quality: { overall, attack, defence, squad }, predictability, volatility, sustainability, betting: { winner, goals, btts, cards }, tier, bettingIntel };
}
