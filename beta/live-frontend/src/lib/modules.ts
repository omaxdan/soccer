// ─────────────────────────────────────────────────────────────────────────────
// PitchTerminal — Module registry
//
// A "module" is one analytical product answering one betting question. Pages
// do not render matches; they render which modules FIRE for a match/team.
//
// Every evaluator is a pure function of data that existing query helpers
// already return. No new fetching happens here (per spec rule 6).
//
// DESIGN CONTRACT — read before adding a module:
//   A `Baseline` cannot be constructed without a `sample`. This is deliberate.
//   A historical rate without an n is a marketing number, not evidence, and
//   the UI is built so that a missing n renders visibly as "unverified"
//   rather than silently as a bare percentage. See <Rate /> in components.
// ─────────────────────────────────────────────────────────────────────────────

import type {
  MatchRow,
  TeamIntelligence,
  TeamFormQuality,
  TeamVenuePerformance,
  TeamMomentum,
  MatchScoringProbabilities,
  LeagueGapSummary,
} from "./types";

// ── Core types ───────────────────────────────────────────

/** supports = agrees with the pick · contradicts = argues against it */
export type ModuleStatus = "supports" | "neutral" | "contradicts" | "inactive";

export type ModuleScope = "match" | "team" | "league";

export type Tier = "starter" | "pro" | "proplus";

export type ModuleKey =
  | "home_away"
  | "readiness"
  | "consistency"
  | "giant_killer"
  | "travel"
  | "rest"
  | "league_goals"
  | "form_gap"
  | "btts_fatigue"
  | "confidence"
  | "halftime"
  | "clean_sheet";

export interface ModuleDef {
  /** Display number — stable, quoted in marketing and support. Never reuse. */
  n: number;
  key: ModuleKey;
  name: string;
  /** The single betting question this module answers. */
  question: string;
  scope: ModuleScope;
  /** Minimum tier required to see the reading. */
  tier: Tier;
  /**
   * The table this module actually reads, shown in the module directory.
   * These are existing warehouse tables — no module requires a precomputed
   * view of its own. Keep this honest; it is the only place a reader can
   * check where a number came from.
   */
  source: string;
}

/**
 * A historical rate WITH its sample. `sample: null` is legal but is rendered
 * as an explicit "unverified" state — never as a clean percentage.
 */
export interface Baseline {
  /** 0–100. */
  rate: number;
  /** Number of historical matches behind `rate`. null = not yet measured. */
  sample: number | null;
  /** What the rate is a rate OF, e.g. "favourite wins". */
  label: string;
  /** Base rate for the same outcome across all matches, if known. */
  baseRate?: number | null;
}

export interface ReadingRow {
  label: string;
  value: string;
  /** Optional CSS colour token for the value. */
  color?: string;
}

export interface ModuleReading {
  def: ModuleDef;
  status: ModuleStatus;
  /** One-line live datum, e.g. "Gap +10 · Lean zone". */
  headline: string;
  rows: ReadingRow[];
  baseline: Baseline | null;
  /** One-line plain-English call. Never a recommendation to stake. */
  verdict: string;
}

// ── Registry ─────────────────────────────────────────────

export const MODULES: ModuleDef[] = [
  {
    n: 1,
    key: "home_away",
    name: "Home/Away Split",
    question: "Home-reliant or road warrior?",
    scope: "team",
    tier: "starter",
    source: "team_venue_performance",
  },
  {
    n: 2,
    key: "readiness",
    name: "Readiness Tracker",
    question: "Peaking or crashing?",
    scope: "team",
    tier: "pro",
    source: "team_momentum",
  },
  {
    n: 3,
    key: "consistency",
    name: "Consistency Index",
    question: "Predictable or volatile?",
    scope: "team",
    tier: "pro",
    source: "team_form_quality.volatility",
  },
  {
    n: 4,
    key: "giant_killer",
    name: "Giant Killer Index",
    question: "Steps up against top teams?",
    scope: "team",
    tier: "pro",
    source: "team_form_quality.giant_killer_score",
  },
  {
    n: 5,
    key: "travel",
    name: "Travel Impact",
    question: "Does distance matter here?",
    scope: "match",
    tier: "starter",
    source: "match_intelligence.away_travel_distance_km",
  },
  {
    n: 6,
    key: "rest",
    name: "Rest Advantage",
    question: "Is a rest gap worth an edge?",
    scope: "match",
    tier: "pro",
    source: "match_intelligence.home/away_rest_days",
  },
  {
    n: 7,
    key: "league_goals",
    name: "League Goal Profile",
    question: "Over or under league?",
    scope: "league",
    tier: "starter",
    source: "mv_match_scoring_probabilities.league_btts_pct",
  },
  {
    n: 8,
    key: "form_gap",
    name: "Form Gap Accuracy",
    question: "How reliable is this form gap?",
    scope: "match",
    tier: "starter",
    source: "team_intelligence.form_index",
  },
  {
    n: 9,
    key: "btts_fatigue",
    name: "BTTS by Fatigue",
    question: "Is BTTS rest-driven here?",
    scope: "match",
    tier: "pro",
    source: "match_intelligence + mv_match_scoring_probabilities",
  },
  {
    n: 10,
    key: "confidence",
    name: "Confidence Calibration",
    question: "Can this pick be trusted?",
    scope: "match",
    tier: "starter",
    source: "match_intelligence.confidence_band + signal_backtests",
  },
  {
    n: 11,
    key: "halftime",
    name: "Half-Time Trends",
    question: "Any HT/FT pattern?",
    scope: "match",
    tier: "pro",
    source: "match_half_time_intelligence",
  },
  {
    n: 12,
    key: "clean_sheet",
    name: "Clean Sheet Probability",
    question: "How likely is a clean sheet?",
    scope: "match",
    tier: "pro",
    source: "mv_match_scoring_probabilities concede rates",
  },
];

export const MODULE_BY_KEY: Record<ModuleKey, ModuleDef> = MODULES.reduce(
  (acc, m) => ({ ...acc, [m.key]: m }),
  {} as Record<ModuleKey, ModuleDef>
);

/** Free tier: modules 1, 5, 7, 8, 10. */
export const STARTER_KEYS: ModuleKey[] = MODULES.filter(
  (m) => m.tier === "starter"
).map((m) => m.key);

// ── Status → colour token ────────────────────────────────

export function statusColor(s: ModuleStatus): string {
  if (s === "supports") return "var(--edge)";
  if (s === "contradicts") return "var(--risk)";
  if (s === "neutral") return "var(--warn)";
  return "var(--faint)";
}

export function statusWord(s: ModuleStatus): string {
  if (s === "supports") return "SUPPORTS";
  if (s === "contradicts") return "CONTRADICTS";
  if (s === "neutral") return "NEUTRAL";
  return "NO DATA";
}

// ── Helpers ──────────────────────────────────────────────

const num = (v: number | string | null | undefined): number | null => {
  if (v == null) return null;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
};

const sign = (v: number) => (v > 0 ? `+${v}` : `${v}`);

function inactive(def: ModuleDef, why = "Insufficient data"): ModuleReading {
  return {
    def,
    status: "inactive",
    headline: why,
    rows: [],
    baseline: null,
    verdict: "Module did not fire for this fixture.",
  };
}

/**
 * Wilson score interval — the honest way to show a rate with a small n.
 * Returns [lower, upper] as percentages. Used by <Rate /> so that a 97.9%
 * on n=23 visibly reads as the wide, unreliable band it actually is.
 */
export function wilson(ratePct: number, sample: number, z = 1.96): [number, number] {
  if (!sample || sample <= 0) return [0, 100];
  const p = Math.min(1, Math.max(0, ratePct / 100));
  const n = sample;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const lo = ((centre - spread) / denom) * 100;
  const hi = ((centre + spread) / denom) * 100;
  return [Math.max(0, lo), Math.min(100, hi)];
}

/** Width of the 95% interval — the single best "should I trust this" number. */
export function intervalWidth(b: Baseline): number | null {
  if (b.sample == null) return null;
  const [lo, hi] = wilson(b.rate, b.sample);
  return hi - lo;
}

// ── Evaluation context ───────────────────────────────────

export interface MatchModuleContext {
  match: MatchRow;
  /** Which side the platform's pick favours. Derived from readiness gap. */
  pickSide: "home" | "away" | null;
  scoring?: MatchScoringProbabilities | null;
  /** League-level measured hit rate for this competition, if available. */
  leagueGap?: LeagueGapSummary | null;
}

export interface TeamModuleContext {
  intel: TeamIntelligence | null;
  formQuality: TeamFormQuality | null;
  venue: TeamVenuePerformance | null;
  momentum: TeamMomentum | null;
}

// ── Match-scope evaluators ───────────────────────────────

function evalFormGap(ctx: MatchModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.form_gap;
  const h = ctx.match.homeIntel?.form_index ?? null;
  const a = ctx.match.awayIntel?.form_index ?? null;
  if (h == null || a == null) return inactive(def, "Form index missing");

  const gap = Math.round((h - a) * 10) / 10;
  const abs = Math.abs(gap);

  // Zone thresholds and rates are the published form-gap figures. Samples
  // are null because no measured n exists for them yet — backtestSignals
  // already measures FORM5_DIFF9_* against real populations, and these rates
  // should be replaced by signal_backtests values once they clear the gate.
  let zone: string;
  let rate: number;
  if (abs > 30) {
    zone = "Banker";
    rate = 75.7;
  } else if (abs >= 15) {
    zone = "Strong";
    rate = 72.6;
  } else if (abs >= 5) {
    zone = "Lean";
    rate = 41.1;
  } else {
    zone = "Coin flip";
    rate = 14.5;
  }

  const favours: "home" | "away" = gap >= 0 ? "home" : "away";
  const agrees = ctx.pickSide == null || ctx.pickSide === favours;

  const status: ModuleStatus =
    abs < 5 ? "neutral" : !agrees ? "contradicts" : abs >= 15 ? "supports" : "neutral";

  return {
    def,
    status,
    headline: `Gap ${sign(gap)} · ${zone} zone`,
    rows: [
      { label: "Home form", value: h.toFixed(1) },
      { label: "Away form", value: a.toFixed(1) },
      { label: "Favours", value: favours === "home" ? "Home" : "Away" },
    ],
    baseline: { rate, sample: null, label: "favourite wins in this zone" },
    verdict:
      abs < 5
        ? "No usable separation — the gap is inside the noise floor."
        : !agrees
        ? "Form gap points the other way from the pick."
        : abs >= 15
        ? "Wide separation. The strongest of the gap zones."
        : "Thin edge — needs corroboration from other modules.",
  };
}

function evalConfidence(ctx: MatchModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.confidence;
  const band = ctx.match.intel?.confidence_band ?? null;
  if (!band) return inactive(def, "Band not computed");

  // Bands and their backtested accuracy. Samples ARE known here, which is
  // exactly why this module is the one that shows an interval.
  const TABLE: Record<string, { rate: number; sample: number }> = {
    Elite: { rate: 95.7, sample: 23 },
    Strong: { rate: 97.9, sample: 326 },
    Moderate: { rate: 78.4, sample: 439 },
    Risky: { rate: 46.2, sample: 785 },
    Avoid: { rate: 29.4, sample: 320 },
  };
  const row = TABLE[band] ?? null;
  const score = ctx.match.intel?.confidence_score ?? null;
  const gap = ctx.match.intel?.readiness_gap ?? null;

  const status: ModuleStatus =
    band === "Elite" || band === "Strong"
      ? "supports"
      : band === "Moderate"
      ? "neutral"
      : "contradicts";

  return {
    def,
    status,
    headline: `${band} band${score != null ? ` · score ${score.toFixed(1)}` : ""}`,
    rows: [
      { label: "Band", value: band },
      { label: "Readiness gap", value: gap != null ? sign(Math.round(gap)) : "—" },
      { label: "Evidence streams", value: score != null ? "≥ 4" : "—" },
    ],
    baseline: row
      ? { rate: row.rate, sample: row.sample, label: "favourite wins in this band" }
      : null,
    verdict:
      band === "Avoid"
        ? "The band is the model saying it does not know. Treat the pick as unsupported."
        : band === "Risky"
        ? "Below the coin-flip line historically. Low trust."
        : band === "Moderate"
        ? "Usable, with roughly a one-in-five upset rate."
        : "Highest measured band — but see the interval, not just the headline rate.",
  };
}

function evalTravel(ctx: MatchModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.travel;
  const km = ctx.match.intel?.away_travel_distance_km ?? null;
  if (km == null) return inactive(def, "Travel distance missing");

  let band: string;
  let awayRate: number;
  let homeRate: number;
  if (km < 100) {
    band = "Minimal (<100km)";
    awayRate = 28.6;
    homeRate = 48.1;
  } else if (km <= 300) {
    band = "Short (100–300km)";
    awayRate = 26.3;
    homeRate = 44.9;
  } else if (km <= 600) {
    band = "Moderate (300–600km)";
    awayRate = 26.0;
    homeRate = 44.4;
  } else {
    band = "Long (600km+)";
    awayRate = 28.8;
    homeRate = 42.3;
  }

  // Away win rate barely moves across bands (26–29%). Travel alone is not a
  // signal; saying otherwise would be dishonest. This module is neutral by
  // construction unless paired with rest.
  return {
    def,
    status: "neutral",
    headline: `${Math.round(km).toLocaleString()} km · ${band}`,
    rows: [
      { label: "Away travel", value: `${Math.round(km).toLocaleString()} km` },
      { label: "Band", value: band },
      { label: "Home win in band", value: `${homeRate.toFixed(1)}%` },
    ],
    baseline: { rate: awayRate, sample: null, label: "away wins at this distance" },
    verdict:
      "Away win rate moves under 3 points across every distance band — travel alone does not predict. Read it alongside Module 6.",
  };
}

function evalRest(ctx: MatchModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.rest;
  const hr = ctx.match.intel?.home_rest_days ?? null;
  const ar = ctx.match.intel?.away_rest_days ?? null;
  if (hr == null || ar == null) return inactive(def, "Rest days missing");

  const gap = hr - ar;
  let scenario: string;
  let homeRate: number;
  if (gap >= 7) {
    scenario = "Home well rested";
    homeRate = 62.5;
  } else if (gap >= 4) {
    scenario = "Home rest edge";
    homeRate = 52.6;
  } else if (gap >= 1) {
    scenario = "Home slight edge";
    homeRate = 42.0;
  } else if (gap === 0) {
    scenario = "Equal rest";
    homeRate = 43.3;
  } else if (gap >= -3) {
    scenario = "Away slight edge";
    homeRate = 42.0;
  } else {
    scenario = "Away rest edge";
    homeRate = 42.0;
  }

  const favours: "home" | "away" | null = gap >= 4 ? "home" : gap <= -4 ? "away" : null;
  const status: ModuleStatus =
    favours == null
      ? "neutral"
      : ctx.pickSide == null || ctx.pickSide === favours
      ? "supports"
      : "contradicts";

  return {
    def,
    status,
    headline: `${scenario} · gap ${sign(gap)}d`,
    rows: [
      { label: "Home rest", value: `${hr}d` },
      { label: "Away rest", value: `${ar}d` },
      { label: "Gap", value: `${sign(gap)}d` },
    ],
    baseline: { rate: homeRate, sample: null, label: "home wins in this scenario" },
    verdict:
      gap >= 7
        ? "The only rest scenario that clears the home baseline by a wide margin."
        : Math.abs(gap) >= 4
        ? "A four-day gap is the threshold where rest starts to register."
        : "Rest is effectively level — no edge from this module.",
  };
}

function evalBttsFatigue(ctx: MatchModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.btts_fatigue;
  const hr = ctx.match.intel?.home_rest_days ?? null;
  const ar = ctx.match.intel?.away_rest_days ?? null;
  if (hr == null || ar == null) return inactive(def, "Rest days missing");

  let scenario: string;
  let rate: number;
  if (ar >= 7 && hr < 7) {
    scenario = "Away rested only";
    rate = 60.0;
  } else if (hr >= 7 && ar >= 7) {
    scenario = "Both rested";
    rate = 53.9;
  } else if (hr < 7 && ar < 7) {
    scenario = "Both fatigued";
    rate = 52.7;
  } else {
    scenario = "Home rested only";
    rate = 51.3;
  }

  // Live BTTS estimate from the scoring-probability view, if present.
  const live = num(ctx.scoring?.btts_pct ?? null);
  const status: ModuleStatus = rate >= 58 ? "supports" : "neutral";

  return {
    def,
    status,
    headline: `${scenario} · BTTS lean ${rate.toFixed(1)}%`,
    rows: [
      { label: "Home rest", value: `${hr}d` },
      { label: "Away rest", value: `${ar}d` },
      ...(live != null
        ? [{ label: "Live BTTS estimate", value: `${live.toFixed(0)}%` }]
        : []),
    ],
    baseline: { rate, sample: null, label: "BTTS in this fatigue scenario" },
    verdict:
      rate >= 58
        ? "A rested away side is the one fatigue split that meaningfully lifts BTTS."
        : "Spread across fatigue scenarios is under 3 points — weak on its own.",
  };
}

function evalCleanSheet(ctx: MatchModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.clean_sheet;
  const s = ctx.scoring;
  if (!s) return inactive(def, "Scoring probabilities unavailable");

  // Clean sheet = the opponent fails to score. Derived from the concede rates
  // already carried by match_scoring_probabilities, WITH their samples.
  const homeConcedes = num(s.home_concedes_pct);
  const awayConcedes = num(s.away_concedes_pct);
  const homeCs = homeConcedes != null ? 100 - homeConcedes : null;
  const awayCs = awayConcedes != null ? 100 - awayConcedes : null;
  if (homeCs == null && awayCs == null) return inactive(def, "Concede rates missing");

  const hs = s.home_concede_sample ?? null;
  const as = s.away_concede_sample ?? null;

  let profile = "No clean-sheet edge";
  if ((homeCs ?? 0) >= 50 && (awayCs ?? 0) <= 20) profile = "Home clean sheet strong";
  else if ((awayCs ?? 0) >= 50 && (homeCs ?? 0) <= 20) profile = "Away clean sheet strong";
  else if ((homeCs ?? 0) >= 40 && (awayCs ?? 0) >= 40) profile = "Both solid";
  else if ((homeCs ?? 0) <= 20 && (awayCs ?? 0) <= 20) profile = "Both leaky";

  const pickSideCs =
    ctx.pickSide === "home" ? homeCs : ctx.pickSide === "away" ? awayCs : null;
  const status: ModuleStatus =
    pickSideCs == null
      ? "neutral"
      : pickSideCs >= 45
      ? "supports"
      : pickSideCs <= 20
      ? "contradicts"
      : "neutral";

  return {
    def,
    status,
    headline: profile,
    rows: [
      {
        label: "Home CS rate",
        value: homeCs != null ? `${homeCs.toFixed(0)}%${hs ? ` (n=${hs})` : ""}` : "—",
      },
      {
        label: "Away CS rate",
        value: awayCs != null ? `${awayCs.toFixed(0)}%${as ? ` (n=${as})` : ""}` : "—",
      },
    ],
    baseline:
      homeCs != null ? { rate: homeCs, sample: hs, label: "home clean sheets" } : null,
    verdict:
      status === "contradicts"
        ? "The pick side rarely keeps a clean sheet — this argues against a narrow win."
        : status === "supports"
        ? "The pick side shuts opponents out often enough to matter."
        : "Neither side has a decisive shut-out habit.",
  };
}

function evalHalftime(ctx: MatchModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.halftime;
  const ht = ctx.match.halfTime;
  if (!ht) return inactive(def, "Half-time model unavailable");

  const options = [
    { k: "Home/Home", v: ht.hh_prob },
    { k: "Draw/Home", v: ht.dh_prob },
    { k: "Draw/Draw", v: ht.dd_prob },
    { k: "Away/Away", v: ht.aa_prob },
  ].filter((o) => o.v != null) as { k: string; v: number }[];
  if (options.length === 0) return inactive(def, "No HT/FT probabilities");

  const top = options.sort((a, b) => b.v - a.v)[0];
  const status: ModuleStatus = top.v >= 30 ? "supports" : "neutral";

  return {
    def,
    status,
    headline: `${top.k} most likely · ${top.v.toFixed(0)}%`,
    rows: options.map((o) => ({ label: o.k, value: `${o.v.toFixed(0)}%` })),
    baseline: null,
    verdict:
      top.v >= 30
        ? "One HT/FT path is clearly dominant — worth a look on the correct-half markets."
        : "HT/FT probability is spread thin. No standout path.",
  };
}

function evalLeagueGoals(ctx: MatchModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.league_goals;
  const s = ctx.scoring;
  const leagueBtts = num(s?.league_btts_pct ?? null);
  const predTotal =
    (ctx.match.intel?.predicted_home_goals ?? 0) +
    (ctx.match.intel?.predicted_away_goals ?? 0);

  if (leagueBtts == null && !predTotal) return inactive(def, "League profile unavailable");

  const profile =
    leagueBtts == null
      ? "Unclassified"
      : leagueBtts >= 60
      ? "Goal heavy"
      : leagueBtts <= 40
      ? "Goal light"
      : "Moderate";

  return {
    def,
    status: profile === "Moderate" || profile === "Unclassified" ? "neutral" : "supports",
    headline: `${ctx.match.competition ?? "League"} · ${profile}`,
    rows: [
      ...(leagueBtts != null
        ? [{ label: "League BTTS", value: `${leagueBtts.toFixed(1)}%` }]
        : []),
      ...(predTotal
        ? [{ label: "Predicted goals", value: predTotal.toFixed(1) }]
        : []),
    ],
    baseline:
      leagueBtts != null
        ? { rate: leagueBtts, sample: null, label: "BTTS across this competition" }
        : null,
    verdict:
      profile === "Goal heavy"
        ? "This competition runs hot. Over and BTTS markets start from a higher base."
        : profile === "Goal light"
        ? "Low-scoring competition. Unders start from a higher base."
        : "League scoring sits near the global average — no league-level tilt.",
  };
}

// ── Team-scope evaluators ────────────────────────────────

function evalHomeAway(ctx: TeamModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.home_away;
  const v = ctx.venue;
  const hw = v?.home_win_pct ?? null;
  const aw = v?.away_win_pct ?? null;
  if (hw == null || aw == null) return inactive(def, "Venue split unavailable");

  const disparity = Math.round((hw - aw) * 10) / 10;
  let type = "Neutral";
  if (hw >= 66 && aw <= 20) type = "Home reliant";
  else if (aw >= 66 && hw <= 20) type = "Road warrior";
  else if (hw >= 60 && aw >= 40) type = "All weather";

  const status: ModuleStatus =
    type === "Neutral" ? "neutral" : Math.abs(disparity) >= 40 ? "supports" : "neutral";

  return {
    def,
    status,
    headline: `${type} · split ${sign(disparity)}`,
    rows: [
      { label: "Home win", value: `${hw.toFixed(0)}%`, color: "var(--edge)" },
      { label: "Away win", value: `${aw.toFixed(0)}%`, color: "var(--cool)" },
      { label: "Disparity", value: sign(disparity) },
    ],
    baseline: { rate: hw, sample: null, label: "home wins" },
    verdict:
      type === "Home reliant"
        ? "Wins at home, does not travel. Fade away fixtures until this shifts."
        : type === "Road warrior"
        ? "Unusual profile — better on the road than at home."
        : type === "All weather"
        ? "Venue-agnostic. Venue should not adjust your read."
        : "No meaningful venue effect.",
  };
}

function evalReadinessTracker(ctx: TeamModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.readiness;
  const m = ctx.momentum;
  const last5 = m?.last_5_points ?? null;
  const prior5 = m?.prior_5_points ?? null;
  if (last5 == null || prior5 == null) return inactive(def, "No prior window to compare");

  const change = last5 - prior5;
  let trend = "Stable";
  if (change >= 5) trend = "Surging";
  else if (change <= -5) trend = "Crashing";
  else if (change >= 2) trend = "Improving";
  else if (change <= -2) trend = "Declining";

  const status: ModuleStatus =
    trend === "Surging" ? "supports" : trend === "Crashing" ? "contradicts" : "neutral";

  return {
    def,
    status,
    headline: `${trend} · ${sign(change)} pts vs prior 5`,
    rows: [
      { label: "Last 5 pts", value: `${last5}` },
      { label: "Prior 5 pts", value: `${prior5}` },
      { label: "Change", value: sign(change) },
    ],
    baseline: null,
    verdict:
      trend === "Surging"
        ? "Points rate has jumped sharply — the market may not have caught up yet."
        : trend === "Crashing"
        ? "Sharp decline. Prices built on older form are likely stale in the wrong direction."
        : "Form is holding roughly level across the two windows.",
  };
}

function evalConsistency(ctx: TeamModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.consistency;
  const q = ctx.formQuality;
  const vol = q?.volatility ?? null;
  if (vol == null) return inactive(def, "Volatility not computed");

  const oaf = q?.opponent_adjusted_form ?? null;
  let profile = "Moderate";
  if (vol <= 0.6 && (oaf ?? 0) >= 70) profile = "Reliable strong";
  else if (vol <= 0.6 && (oaf ?? 100) < 40) profile = "Reliable weak";
  else if (vol <= 0.6) profile = "Predictable";
  else if (vol >= 1.5) profile = "Erratic";

  const status: ModuleStatus =
    profile === "Erratic" ? "contradicts" : vol <= 0.6 ? "supports" : "neutral";

  return {
    def,
    status,
    headline: `${profile} · volatility ${vol.toFixed(2)}`,
    rows: [
      { label: "Volatility", value: vol.toFixed(2) },
      ...(oaf != null
        ? [{ label: "Opp-adj form", value: oaf.toFixed(0) }]
        : []),
      ...(q?.strength_of_schedule != null
        ? [{ label: "Sched strength", value: q.strength_of_schedule.toFixed(0) }]
        : []),
    ],
    baseline: null,
    verdict:
      profile === "Erratic"
        ? "Results swing hard match to match. Any single-match read is fragile."
        : vol <= 0.6
        ? "Results repeat. This is the profile where form-based reads hold up best."
        : "Middling repeatability — neither reliable nor chaotic.",
  };
}

function evalGiantKiller(ctx: TeamModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.giant_killer;
  const q = ctx.formQuality;
  const gk = q?.giant_killer_score ?? null;
  const ftb = q?.flat_track_bully_score ?? null;
  if (gk == null && ftb == null) return inactive(def, "Not enough fixtures vs top sides");

  let profile = "Neutral";
  if ((gk ?? 0) >= 80) profile = "Strong vs top";
  else if ((ftb ?? 0) >= 70) profile = "Flat-track bully";
  else if ((q?.ppg_vs_top ?? 9) <= 0.5) profile = "Struggles vs top";

  const status: ModuleStatus =
    profile === "Strong vs top"
      ? "supports"
      : profile === "Flat-track bully" || profile === "Struggles vs top"
      ? "contradicts"
      : "neutral";

  return {
    def,
    status,
    headline: profile,
    rows: [
      ...(gk != null ? [{ label: "Giant killer", value: gk.toFixed(0) }] : []),
      ...(ftb != null ? [{ label: "Flat-track bully", value: ftb.toFixed(0) }] : []),
      ...(q?.ppg_vs_top != null
        ? [{ label: "PPG vs top", value: q.ppg_vs_top.toFixed(2) }]
        : []),
      ...(q?.ppg_vs_bottom != null
        ? [{ label: "PPG vs bottom", value: q.ppg_vs_bottom.toFixed(2) }]
        : []),
    ],
    baseline: null,
    verdict:
      profile === "Strong vs top"
        ? "Raises its level against better opposition — record understates it in big fixtures."
        : profile === "Flat-track bully"
        ? "Beats weak sides, folds against strong ones. Its table position flatters it."
        : profile === "Struggles vs top"
        ? "Collects almost nothing against the top group."
        : "No clear tier effect either way.",
  };
}

// ── Public API ───────────────────────────────────────────

/** Which side the platform's readiness gap favours. */
export function derivePickSide(match: MatchRow): "home" | "away" | null {
  const gap = match.intel?.readiness_gap ?? null;
  if (gap == null || gap === 0) return null;
  return gap > 0 ? "home" : "away";
}

/** Full per-match module report, ordered so firing modules surface first. */
export function evaluateMatchModules(ctx: MatchModuleContext): ModuleReading[] {
  const readings = [
    evalConfidence(ctx),
    evalFormGap(ctx),
    evalRest(ctx),
    evalCleanSheet(ctx),
    evalBttsFatigue(ctx),
    evalTravel(ctx),
    evalHalftime(ctx),
    evalLeagueGoals(ctx),
  ];
  const rank: Record<ModuleStatus, number> = {
    contradicts: 0,
    supports: 1,
    neutral: 2,
    inactive: 3,
  };
  return readings.sort((a, b) => rank[a.status] - rank[b.status] || a.def.n - b.def.n);
}

/** Full per-team module report. */
export function evaluateTeamModules(ctx: TeamModuleContext): ModuleReading[] {
  return [
    evalHomeAway(ctx),
    evalReadinessTracker(ctx),
    evalConsistency(ctx),
    evalGiantKiller(ctx),
  ];
}

export interface ModuleTally {
  supports: number;
  neutral: number;
  contradicts: number;
  inactive: number;
  /** Firing = anything that produced a reading. */
  firing: number;
}

export function tally(readings: ModuleReading[]): ModuleTally {
  const t: ModuleTally = {
    supports: 0,
    neutral: 0,
    contradicts: 0,
    inactive: 0,
    firing: 0,
  };
  for (const r of readings) {
    t[r.status] += 1;
    if (r.status !== "inactive") t.firing += 1;
  }
  return t;
}

/**
 * Overall confidence from the module spread. Deliberately conservative: a
 * single contradicting module caps the result, because in backtests the
 * failure mode is always "we ignored the one signal that disagreed".
 */
export function overallVerdict(t: ModuleTally): {
  label: "STRONG" | "MODERATE" | "WEAK" | "NO READ";
  color: string;
} {
  if (t.firing === 0) return { label: "NO READ", color: "var(--faint)" };
  if (t.contradicts >= 2) return { label: "WEAK", color: "var(--risk)" };
  if (t.supports >= 5 && t.contradicts === 0)
    return { label: "STRONG", color: "var(--edge)" };
  if (t.supports >= 3) return { label: "MODERATE", color: "var(--warn)" };
  return { label: "WEAK", color: "var(--risk)" };
}
