import type {
  TeamIntelligence, TeamFormQuality, TeamVenuePerformance, TeamGoalDependency,
} from "./types";
import type { PerformanceIntel } from "./performance";

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
  formQuality: TeamFormQuality | null;
  venue: TeamVenuePerformance | null;
  goalDep: TeamGoalDependency | null;
  perf: PerformanceIntel | null;
}): TeamProfile {
  const { intel, formQuality, venue, goalDep, perf } = input;

  const attack = perf?.attackEfficiency ?? clamp((intel?.form_index ?? 50));
  const defence = fragToScore(perf?.defenseFragility ?? null) ?? clamp((intel?.squad_stability_score ?? 50));
  const squad = clamp(intel?.squad_depth_score ?? intel?.squad_stability_score ?? 50);
  const overall = Math.round((attack * 0.4 + defence * 0.35 + squad * 0.25));

  const volatility = clamp(formQuality?.volatility ?? 30);
  const predictability = clamp(100 - volatility);

  // Sustainability from expected vs actual points
  const delta = formQuality?.performance_delta ?? null;
  let sustainability: TeamProfile["sustainability"];
  if (delta == null) {
    sustainability = { label: "Unknown", regressionRisk: "MEDIUM", delta: null, reading: "Not enough underlying data to judge sustainability." };
  } else if (delta >= 2) {
    sustainability = { label: "Over-performing", regressionRisk: "HIGH", delta, reading: "Results run ahead of the underlying numbers — a regression (and fade) candidate." };
  } else if (delta <= -2) {
    sustainability = { label: "Under-performing", regressionRisk: "LOW", delta, reading: "Underlying play beats the results — better outcomes look due." };
  } else {
    sustainability = { label: "Sustainable", regressionRisk: "LOW", delta, reading: "Results are earned — output tracks the underlying process." };
  }

  // Betting profile
  const venueAdv = venue?.venue_advantage_score ?? 50;
  const winner = marketRead(overall * 0.6 + venueAdv * 0.4);

  const goalsSignal = perf?.signals.find((s) => s.group === "goals");
  const goals = marketRead(goalsSignal ? goalsSignal.confidence : attack);

  const bttsSignal = perf?.signals.find((s) => s.group === "btts");
  const btts = marketRead(bttsSignal ? bttsSignal.confidence : 50);

  const cardsScore = perf?.discipline
    ? clamp((4 - (perf.discipline.score ?? 50) / 25) * 25)
    : 30;
  const cards = marketRead(perf?.discipline && perf.discipline.tier.includes("risk") ? 70 : cardsScore < 40 ? 30 : cardsScore);

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

  return { quality: { overall, attack, defence, squad }, predictability, volatility, sustainability, betting: { winner, goals, btts, cards }, tier };
}
