// ─────────────────────────────────────────────────────────────────────────────
// teamBrief — turns the metrics getTeamIntel already returns into the shape the
// team page reads: an executive summary, badges, insights, three pillars, a
// market profile and a danger zone.
//
// TWO RULES HOLD THROUGHOUT, AND THEY ARE THE POINT:
//
//   1. Nothing here computes a new score. Every number is a column. The
//      functions choose which existing metric to surface and what sentence to
//      attach to it; they never blend, weight or rescale. If a value is not in
//      the warehouse it does not appear.
//
//   2. Everything is null-safe and omitting. A missing metric produces no
//      badge, no insight, no pillar — not a card reading "No data". The page
//      is meant to look intentional on a team with thin coverage, which means
//      absence has to be silent rather than rendered.
//
// Sentences are assembled from the value and its band, so the same metric on a
// different team produces different prose. Nothing is written per team.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  TeamIntelligence,
  TeamFormQuality,
  TeamVenuePerformance,
  TeamMomentum,
  TeamBettingIntelligence,
  TeamGoalDependency,
  TeamStrengthDashboard,
  TeamPlayingStyle,
} from "./types";

export type Tone = "good" | "warn" | "bad" | "neutral";

export const toneColor: Record<Tone, string> = {
  good: "var(--edge)",
  warn: "var(--warn)",
  bad: "var(--risk)",
  neutral: "var(--muted)",
};

export interface Badge {
  label: string;
  tone: Tone;
}

export interface Insight {
  title: string;
  tone: Tone;
  /** Supporting facts, each already carrying its own number. */
  points: string[];
}

export interface Pillar {
  name: string;
  score: number;
  /** Direction of travel, when a trend metric exists for it. */
  trend: string | null;
  sentence: string;
}

export interface MarketRow {
  market: string;
  score: number;
  band: "Strong" | "Medium" | "Low";
  sentence: string;
}

export interface Risk {
  title: string;
  why: string;
  effect: string;
}

export interface TeamBriefInput {
  teamName: string;
  intel: TeamIntelligence | null;
  formQuality: TeamFormQuality | null;
  venue: TeamVenuePerformance | null;
  momentum: TeamMomentum | null;
  betting: TeamBettingIntelligence | null;
  goalDep: TeamGoalDependency | null;
  dashboard: TeamStrengthDashboard | null;
  style: TeamPlayingStyle | null;
}

// ── Helpers ──────────────────────────────────────────────

const n = (v: unknown): number | null => {
  if (v == null) return null;
  const x = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(x) ? x : null;
};

/** Descriptive band for a 0–100 metric. Used for wording only. */
function band(v: number): "elite" | "strong" | "average" | "weak" {
  if (v >= 80) return "elite";
  if (v >= 65) return "strong";
  if (v >= 45) return "average";
  return "weak";
}

function marketBand(v: number): MarketRow["band"] {
  return v >= 65 ? "Strong" : v >= 40 ? "Medium" : "Low";
}

// ── Badges ───────────────────────────────────────────────

export function buildBadges(i: TeamBriefInput): Badge[] {
  const out: Badge[] = [];

  const form = n(i.dashboard?.form_rating) ?? n(i.intel?.form_index);
  if (form != null) {
    const b = band(form);
    out.push({
      label: `${b === "elite" ? "Elite" : b === "strong" ? "Strong" : b === "average" ? "Average" : "Poor"} form`,
      tone: b === "elite" || b === "strong" ? "good" : b === "average" ? "neutral" : "bad",
    });
  }

  const readiness = n(i.intel?.readiness_score);
  if (readiness != null) {
    const b = band(readiness);
    out.push({
      label: `${b === "elite" || b === "strong" ? "High" : b === "average" ? "Moderate" : "Low"} readiness`,
      tone: b === "elite" || b === "strong" ? "good" : b === "average" ? "neutral" : "bad",
    });
  }

  const vol = n(i.formQuality?.volatility);
  if (vol != null) {
    out.push({
      label: vol >= 1.5 ? "High volatility" : vol <= 0.6 ? "Low volatility" : "Moderate volatility",
      tone: vol >= 1.5 ? "warn" : vol <= 0.6 ? "good" : "neutral",
    });
  }

  // Regression risk reads performance_delta: points earned above or below the
  // expected-points model. A large positive delta is the classic "results
  // flattering the underlying numbers" case.
  const delta = n(i.formQuality?.performance_delta);
  if (delta != null) {
    const mag = Math.abs(delta);
    out.push({
      label: `${mag >= 4 ? "High" : mag >= 2 ? "Medium" : "Low"} regression risk`,
      tone: mag >= 4 ? "warn" : mag >= 2 ? "neutral" : "good",
    });
  }

  const conf = i.betting?.sample_confidence ?? null;
  if (conf) {
    const c = conf.toUpperCase();
    out.push({
      label: `${c.charAt(0)}${c.slice(1).toLowerCase()} sample confidence`,
      tone: c === "HIGH" ? "good" : c === "MEDIUM" ? "neutral" : "warn",
    });
  }

  return out;
}

// ── Executive summary ────────────────────────────────────

/**
 * Two to four sentences, each one only emitted when its metric exists. A team
 * with nothing but a form index gets one sentence rather than a paragraph of
 * hedged filler.
 */
export function buildSummary(i: TeamBriefInput): string | null {
  const parts: string[] = [];
  const name = i.teamName;

  const form = n(i.dashboard?.form_rating) ?? n(i.intel?.form_index);
  const last5 = i.intel?.last_5_results ?? null;
  if (form != null) {
    const trend = i.dashboard?.form_trend ?? i.momentum?.trend ?? null;
    parts.push(
      `${name} carry a ${band(form)} form rating of ${Math.round(form)}` +
        (last5 ? ` from ${last5}` : "") +
        (trend ? `, trending ${trend.toLowerCase()}` : "") +
        "."
    );
  }

  const readiness = n(i.intel?.readiness_score);
  if (readiness != null) {
    const rest = n(i.intel?.rest_days_avg);
    const congestion = n(i.intel?.congestion_score);
    const bits = [
      rest != null ? `${rest.toFixed(1)} days average rest` : null,
      congestion != null ? `congestion ${Math.round(congestion)}/100` : null,
    ].filter(Boolean);
    parts.push(
      `Readiness sits at ${Math.round(readiness)}` +
        (bits.length ? ` on ${bits.join(" and ")}` : "") +
        "."
    );
  }

  // Strongest and weakest of the rated units — chosen by value, not assigned.
  const units = [
    { k: "attack", v: n(i.dashboard?.attack_rating) ?? n(i.betting?.attack_rating) },
    { k: "midfield", v: n(i.dashboard?.midfield_rating) },
    { k: "defence", v: n(i.dashboard?.defense_rating) ?? n(i.betting?.defence_rating) },
  ].filter((u): u is { k: string; v: number } => u.v != null);
  if (units.length >= 2) {
    const best = units.reduce((a, b) => (b.v > a.v ? b : a));
    const worst = units.reduce((a, b) => (b.v < a.v ? b : a));
    if (best.k !== worst.k)
      parts.push(
        `The ${best.k} is the strongest unit at ${Math.round(best.v)}, the ${worst.k} the weakest at ${Math.round(worst.v)}.`
      );
  }

  const vol = n(i.formQuality?.volatility);
  const window = n(i.formQuality?.window_matches);
  if (vol != null) {
    parts.push(
      vol >= 1.5
        ? `Results swing sharply match to match (volatility ${vol.toFixed(2)}${window ? ` over ${window} matches` : ""}), so a single-match read is fragile.`
        : vol <= 0.6
          ? `Results repeat closely (volatility ${vol.toFixed(2)}${window ? ` over ${window} matches` : ""}), which is the profile where form-based reads hold up best.`
          : `Match-to-match repeatability is middling (volatility ${vol.toFixed(2)}).`
    );
  }

  return parts.length ? parts.slice(0, 4).join(" ") : null;
}

// ── Key insights ─────────────────────────────────────────

/** Only insights that fire. Capped at five, strongest signal first. */
export function buildInsights(i: TeamBriefInput): Insight[] {
  const out: (Insight & { weight: number })[] = [];

  const readiness = n(i.intel?.readiness_score);
  if (readiness != null && (readiness >= 75 || readiness <= 40)) {
    const points = [
      n(i.intel?.rest_days_avg) != null ? `${n(i.intel!.rest_days_avg)!.toFixed(1)} days average rest` : null,
      n(i.intel?.congestion_score) != null ? `Congestion ${Math.round(n(i.intel!.congestion_score)!)}/100` : null,
      n(i.intel?.travel_fatigue_score) != null ? `Travel fatigue ${Math.round(n(i.intel!.travel_fatigue_score)!)}/100` : null,
    ].filter((p): p is string => p !== null);
    out.push({
      title: readiness >= 75 ? `Elite readiness (${Math.round(readiness)})` : `Depleted readiness (${Math.round(readiness)})`,
      tone: readiness >= 75 ? "good" : "bad",
      points,
      weight: Math.abs(readiness - 50),
    });
  }

  const vol = n(i.formQuality?.volatility);
  if (vol != null && (vol >= 1.5 || vol <= 0.6)) {
    out.push({
      title: vol >= 1.5 ? `High volatility (${vol.toFixed(2)})` : `Highly repeatable (${vol.toFixed(2)})`,
      tone: vol >= 1.5 ? "warn" : "good",
      points: [
        vol >= 1.5
          ? "Consistency Index indicates unstable match-to-match output."
          : "Consistency Index indicates stable match-to-match output.",
        n(i.formQuality?.window_matches) != null
          ? `Measured over ${n(i.formQuality!.window_matches)} matches.`
          : "",
      ].filter(Boolean),
      weight: 40,
    });
  }

  // Venue split fires either way, including the honest "sample too small".
  const hw = n(i.venue?.home_win_pct);
  const aw = n(i.venue?.away_win_pct);
  const hm = n(i.venue?.home_matches);
  const am = n(i.venue?.away_matches);
  if (hw != null && aw != null) {
    const thin = (hm ?? 0) < 5 || (am ?? 0) < 5;
    const gap = hw - aw;
    if (thin) {
      out.push({
        title: "Venue split unproven",
        tone: "neutral",
        points: [
          `${Math.round(hw)}% at home (n=${hm ?? 0}) against ${Math.round(aw)}% away (n=${am ?? 0}).`,
          "Sample too small to separate a venue effect from noise.",
        ],
        weight: 10,
      });
    } else if (Math.abs(gap) >= 30) {
      out.push({
        title: gap > 0 ? `Home reliant (+${Math.round(gap)})` : `Travels well (${Math.round(gap)})`,
        tone: "good",
        points: [
          `${Math.round(hw)}% at home (n=${hm}) against ${Math.round(aw)}% away (n=${am}).`,
        ],
        weight: Math.abs(gap),
      });
    }
  }

  const gk = n(i.formQuality?.giant_killer_score);
  const ppgTop = n(i.formQuality?.ppg_vs_top);
  const vsTop = n(i.formQuality?.matches_vs_top);
  if (gk != null && (gk >= 75 || gk <= 25) && (vsTop ?? 0) >= 3) {
    out.push({
      title: gk >= 75 ? `Raises level against top sides (${Math.round(gk)})` : `Struggles against top sides (${Math.round(gk)})`,
      tone: gk >= 75 ? "good" : "warn",
      points: [
        ppgTop != null ? `${ppgTop.toFixed(2)} points per game versus the top tier (n=${vsTop}).` : "",
      ].filter(Boolean),
      weight: Math.abs(gk - 50),
    });
  }

  const change =
    n(i.momentum?.last_5_points) != null && n(i.momentum?.prior_5_points) != null
      ? n(i.momentum!.last_5_points)! - n(i.momentum!.prior_5_points)!
      : null;
  if (change != null && Math.abs(change) >= 5) {
    out.push({
      title: change > 0 ? `Momentum surging (+${change})` : `Momentum collapsing (${change})`,
      tone: change > 0 ? "good" : "bad",
      points: [
        `${i.momentum!.last_5_points} points from the last five, against ${i.momentum!.prior_5_points} in the five before.`,
      ],
      weight: Math.abs(change) * 5,
    });
  }

  return out
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map(({ weight: _w, ...rest }) => rest);
}

// ── Three pillars ────────────────────────────────────────

export function buildPillars(i: TeamBriefInput): Pillar[] {
  const out: Pillar[] = [];

  const attack = n(i.dashboard?.attack_rating) ?? n(i.betting?.attack_rating);
  if (attack != null) {
    const finishing = n(i.betting?.finishing_efficiency);
    const creation = n(i.betting?.goal_creation_score);
    out.push({
      name: "Attack",
      score: Math.round(attack),
      trend: i.dashboard?.form_trend ?? null,
      sentence:
        finishing != null && creation != null
          ? finishing > creation
            ? `Efficient rather than explosive — finishing ${Math.round(finishing)} against chance creation ${Math.round(creation)}.`
            : `Volume over precision — chance creation ${Math.round(creation)} against finishing ${Math.round(finishing)}.`
          : `Rated ${band(attack)} among tracked sides.`,
    });
  }

  const defence = n(i.dashboard?.defense_rating) ?? n(i.betting?.defence_rating);
  if (defence != null) {
    const cs = n(i.betting?.clean_sheet_reliability);
    out.push({
      name: "Defence",
      score: Math.round(defence),
      trend: null,
      sentence:
        cs != null
          ? `Clean-sheet reliability ${Math.round(cs)}/100.`
          : `Rated ${band(defence)} among tracked sides.`,
    });
  }

  const readiness = n(i.intel?.readiness_score);
  if (readiness != null) {
    const rest = n(i.intel?.rest_days_avg);
    const travel = n(i.intel?.travel_fatigue_score);
    const bits = [
      rest != null ? `${rest.toFixed(1)} days average rest` : null,
      travel != null ? `travel fatigue ${Math.round(travel)}/100` : null,
    ].filter(Boolean);
    out.push({
      name: "Readiness",
      score: Math.round(readiness),
      trend: null,
      sentence: bits.length ? `${bits.join(", ")}.` : `Rated ${band(readiness)}.`,
    });
  }

  return out;
}

// ── Market profile ───────────────────────────────────────
// Descriptive only. These say where the team's own profile has been most
// separable, never what to back — that judgement needs both sides and belongs
// on the match page.

export function buildMarkets(i: TeamBriefInput): MarketRow[] {
  const b = i.betting;
  if (!b) return [];
  const rows: [string, number | null, string][] = [
    ["Winner market", n(b.winner_market_score), "How decisively results have separated from the field."],
    ["Goals market", n(b.goals_market_score), "How far this side's matches sit from an average scoring profile."],
    ["Both teams to score", n(b.btts_score), "How consistently both ends of the pitch have been breached."],
    ["Cards market", n(b.cards_market_score), "How far disciplinary volume departs from the norm."],
  ];
  return rows
    .filter((r): r is [string, number, string] => r[1] != null)
    .map(([market, score, sentence]) => ({
      market,
      score: Math.round(score),
      band: marketBand(score),
      sentence,
    }));
}

// ── Danger zone ──────────────────────────────────────────

export function buildRisks(i: TeamBriefInput): Risk[] {
  const out: Risk[] = [];

  const vol = n(i.formQuality?.volatility);
  if (vol != null && vol >= 1.5)
    out.push({
      title: `High volatility (${vol.toFixed(2)})`,
      why: "Results fluctuate more than the underlying performance level would suggest.",
      effect: "Any single-match read carries wider error than the headline form rating implies.",
    });

  const delta = n(i.formQuality?.performance_delta);
  if (delta != null && Math.abs(delta) >= 2)
    out.push({
      title: `Regression risk (${delta > 0 ? "+" : ""}${delta.toFixed(1)} points)`,
      why:
        delta > 0
          ? "Points earned sit above the expected-points model over the measured window."
          : "Points earned sit below the expected-points model over the measured window.",
      effect:
        delta > 0
          ? "Recent results flatter the underlying numbers; the form rating may overstate the side."
          : "Recent results understate the underlying numbers; the form rating may be harsh.",
    });

  const topPct = n(i.goalDep?.top_scorer_pct);
  if (topPct != null && topPct >= 30)
    out.push({
      title: `Goal dependency (${Math.round(topPct)}%)`,
      why: `${Math.round(topPct)}% of goals come from one player${
        i.goalDep?.top_scorer_goals != null ? ` (${i.goalDep.top_scorer_goals} goals)` : ""
      }.${i.goalDep?.top_scorer_no_backup ? " No comparable backup is recorded." : ""}`,
      effect: "Output is concentrated enough that his absence would move the attacking profile materially.",
    });

  const window = n(i.formQuality?.window_matches);
  if (window != null && window < 5)
    out.push({
      title: `Small sample (${window} matches)`,
      why: "The form-quality window holds fewer than five matches.",
      effect: "Volatility, schedule strength and tier splits are all measured on too little to separate signal from noise.",
    });

  const hm = n(i.venue?.home_matches);
  const am = n(i.venue?.away_matches);
  if ((hm != null && hm < 5) || (am != null && am < 5))
    out.push({
      title: `Thin venue sample (${hm ?? 0}H / ${am ?? 0}A)`,
      why: "Home and away records rest on fewer than five matches each.",
      effect: "A venue split drawn from these counts cannot be distinguished from chance.",
    });

  const conf = i.betting?.sample_confidence?.toUpperCase() ?? null;
  if (conf === "LOW")
    out.push({
      title: "Low sample confidence",
      why: "The betting-intelligence layer flags its own inputs as thin for this side.",
      effect: "Every market score above inherits that limitation.",
    });

  return out;
}

// ── Tactical identity ────────────────────────────────────

export interface IdentityRow {
  label: string;
  value: string;
}

export function buildIdentity(i: TeamBriefInput): IdentityRow[] {
  const s = i.style;
  if (!s) return [];
  const rows: [string, unknown][] = [
    ["Playing style", s.playing_style],
    ["Possession", n(s.possession_score) != null ? `${Math.round(n(s.possession_score)!)}/100` : null],
    ["Passing", s.passing_style],
    ["Attacking", s.attacking_style],
    ["Defensive", s.defensive_style],
    ["Style confidence", n(s.style_confidence) != null ? `${Math.round(n(s.style_confidence)!)}/100` : null],
  ];
  return rows
    .filter((r): r is [string, string] => typeof r[1] === "string" && r[1].length > 0)
    .map(([label, value]) => ({ label, value }));
}
