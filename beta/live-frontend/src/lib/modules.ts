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
  ModuleTravelRow,
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
  | "clean_sheet"
  | "weather";

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
  /** Short label for the dashboard pill grid. Keep to four characters. */
  abbrev: string;
  /**
   * The materialized view backing this module, shown in the directory and
   * counted for the "firing now" figure.
   *
   * NOTE: the in-page evaluators in this file do NOT read these views — they
   * read the base tables directly (match_intelligence, team_form_quality,
   * team_venue_performance, mv_match_scoring_probabilities). So a view's row
   * count and the number of fixtures the evaluators actually light up for can
   * differ, because the view's WHERE clause and the evaluator's null-checks
   * are not the same rule. See MODULE_COUNT_CAVEAT in the directory page.
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
  /**
   * Where the sample came from.
   *
   * "measured"   — counted by backtestSignals / backtestConfidenceBands from a
   *                point-in-time population. Safe to show a confidence interval.
   * "unreplayed" — from the original 1,893-match analysis, which scored finished
   *                matches using CURRENT team form and therefore contains
   *                lookahead. The count is real; the rate it sits beside is not
   *                yet trustworthy. Rendered with a marker, never as a clean stat.
   */
  provenance?: "measured" | "unreplayed";
  /**
   * True when `sample` is the total across every band of this module rather
   * than the count for THIS band. A pooled n cannot support a per-band
   * interval, so <Rate /> suppresses the CI instead of drawing a falsely
   * narrow one.
   */
  pooled?: boolean;
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
  /**
   * Machine-readable classification (VENUE edge, travel profile, weather
   * profile...). Anything outside the card that needs to branch on what a
   * module concluded reads this instead of recomputing from raw columns —
   * that duplication is how the match story ended up contradicting M1.
   */
  code?: string;
}

// ── Registry ─────────────────────────────────────────────

export const MODULES: ModuleDef[] = [
  {
    n: 1,
    abbrev: "H/A",
    key: "home_away",
    name: "Home/Away Split",
    question: "Home-reliant or road warrior?",
    scope: "team",
    tier: "starter",
    source: "mv_module_home_away",
  },
  {
    n: 2,
    abbrev: "RT",
    key: "readiness",
    name: "Readiness Tracker",
    question: "Peaking or crashing?",
    scope: "team",
    tier: "pro",
    source: "mv_module_readiness_tracker",
  },
  {
    n: 3,
    abbrev: "CI",
    key: "consistency",
    name: "Consistency Index",
    question: "Predictable or volatile?",
    scope: "team",
    tier: "pro",
    source: "mv_module_consistency",
  },
  {
    n: 4,
    abbrev: "GKI",
    key: "giant_killer",
    name: "Giant Killer Index",
    question: "Steps up against top teams?",
    scope: "team",
    tier: "pro",
    source: "mv_module_giant_killer",
  },
  {
    n: 5,
    abbrev: "TI",
    key: "travel",
    name: "Travel Impact",
    question: "Does distance matter here?",
    scope: "match",
    tier: "starter",
    source: "mv_module_travel",
  },
  {
    n: 6,
    abbrev: "RA",
    key: "rest",
    name: "Rest Advantage",
    question: "Is a rest gap worth an edge?",
    scope: "match",
    tier: "pro",
    source: "mv_module_rest",
  },
  {
    n: 7,
    abbrev: "LGP",
    key: "league_goals",
    name: "League Goal Profile",
    question: "Over or under league?",
    scope: "league",
    tier: "starter",
    source: "mv_module_league_goals",
  },
  {
    n: 8,
    abbrev: "FGA",
    key: "form_gap",
    name: "Form Gap Accuracy",
    question: "How reliable is this form gap?",
    scope: "match",
    tier: "starter",
    source: "mv_module_form_gap",
  },
  {
    n: 9,
    abbrev: "BTF",
    key: "btts_fatigue",
    name: "BTTS by Fatigue",
    question: "Is BTTS rest-driven here?",
    scope: "match",
    tier: "pro",
    source: "mv_module_btts_fatigue",
  },
  {
    n: 10,
    abbrev: "CC",
    key: "confidence",
    name: "Confidence Calibration",
    question: "Can this pick be trusted?",
    scope: "match",
    tier: "starter",
    source: "mv_module_confidence",
  },
  {
    n: 11,
    abbrev: "HTFT",
    key: "halftime",
    name: "Half-Time Trends",
    question: "Any HT/FT pattern?",
    scope: "match",
    tier: "pro",
    source: "mv_module_halftime",
  },
  {
    n: 12,
    abbrev: "CSP",
    key: "clean_sheet",
    name: "Clean Sheet Probability",
    question: "How likely is a clean sheet?",
    scope: "match",
    tier: "pro",
    source: "mv_module_clean_sheet",
  },
  {
    n: 13,
    abbrev: "WI",
    key: "weather",
    name: "Weather Impact",
    question: "Do the conditions move goals or the result?",
    scope: "match",
    tier: "pro",
    source: "match_weather",
  },
];

// ── Weather reference cells ──────────────────────────────
// Observed cells from the 635-match weather analysis. Only 62 of those 635
// matches fall into a profile at all, so these are thin slices of a thin
// slice. Everything downstream — pooled baseline, which metric leads, the
// status and the verdict wording — is COMPUTED from this table rather than
// written out per profile, so correcting a cell corrects the whole card.
export interface WeatherCell {
  profile: string;
  condition: string;
  tempMin: number;
  tempMax: number;
  sample: number;
  avgGoals: number;
  bttsPct: number;
  over25Pct: number;
  homeWinPct: number;
}

export const WEATHER_CELLS: WeatherCell[] = [
  { profile: "WARM_RAIN",     condition: "Light Rain", tempMin: 20, tempMax: 30, sample: 8,  avgGoals: 3.88, bttsPct: 75.0, over25Pct: 87.5, homeWinPct: 62.5 },
  { profile: "HOT_CLEAR",     condition: "Clear",      tempMin: 30, tempMax: Infinity, sample: 8,  avgGoals: 2.63, bttsPct: 50.0, over25Pct: 75.0, homeWinPct: 87.5 },
  { profile: "WARM_CLOUDY",   condition: "Cloudy",     tempMin: 20, tempMax: 30, sample: 23, avgGoals: 2.52, bttsPct: 56.5, over25Pct: 52.2, homeWinPct: 39.1 },
  { profile: "WARM_OVERCAST", condition: "Overcast",   tempMin: 20, tempMax: 30, sample: 11, avgGoals: 2.55, bttsPct: 63.6, over25Pct: 45.5, homeWinPct: 54.5 },
  { profile: "COOL_CLEAR",    condition: "Clear",      tempMin: 10, tempMax: 20, sample: 6,  avgGoals: 2.67, bttsPct: 50.0, over25Pct: 66.7, homeWinPct: 16.7 },
  { profile: "COOL_RAIN",     condition: "Light Rain", tempMin: 10, tempMax: 20, sample: 6,  avgGoals: 2.33, bttsPct: 33.3, over25Pct: 33.3, homeWinPct: 33.3 },
];

/**
 * Sample floor a cell must clear before it is allowed to drive a directional
 * verdict. Mirrors the backend calibration gate (sample >= 200) that
 * backtestSignals and backtestConfidenceBands publish against, so a weather
 * cell is held to the same standard as every other published rule.
 */
export const WEATHER_MIN_SAMPLE = 200;

/** Weighted pooled rates across every cell — the comparison point. */
export function weatherPooled() {
  const n = WEATHER_CELLS.reduce((t, c) => t + c.sample, 0);
  const w = (pick: (c: WeatherCell) => number) =>
    WEATHER_CELLS.reduce((t, c) => t + (pick(c) * c.sample) / 100, 0);
  return {
    sample: n,
    bttsPct: (w((c) => c.bttsPct) / n) * 100,
    over25Pct: (w((c) => c.over25Pct) / n) * 100,
    homeWinPct: (w((c) => c.homeWinPct) / n) * 100,
    avgGoals: WEATHER_CELLS.reduce((t, c) => t + c.avgGoals * c.sample, 0) / n,
  };
}

export function weatherCellFor(
  tempC: number | null | undefined,
  condition: string | null | undefined
): WeatherCell | null {
  if (tempC == null || !condition) return null;
  const c = condition.trim().toLowerCase();
  return (
    WEATHER_CELLS.find(
      (cell) =>
        cell.condition.toLowerCase() === c &&
        tempC >= cell.tempMin &&
        tempC < cell.tempMax
    ) ?? null
  );
}

/**
 * What one row of a module's view represents. Team modules are one row per
 * team, league modules one row per competition, match modules one row per
 * fixture — so "162" means three different things across the directory and
 * the label has to say which.
 */
export function countUnit(def: ModuleDef, n: number): string {
  const plural = n === 1 ? "" : "s";
  if (def.scope === "team") return `team${plural}`;
  if (def.scope === "league") return `competition${plural}`;
  return `fixture${plural}`;
}

/** URL slug used by the dashboard module filter: m1 … m12. */
export function moduleSlug(def: ModuleDef): string {
  return `m${def.n}`;
}

export function moduleFromSlug(slug: string | undefined | null): ModuleDef | null {
  if (!slug) return null;
  const match = /^m(\d{1,2})$/i.exec(slug.trim());
  if (!match) return null;
  const n = Number(match[1]);
  return MODULES.find((m) => m.n === n) ?? null;
}

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
  /** Row from mv_module_travel for this fixture, when loaded. */
  travel?: ModuleTravelRow | null;
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
  if (h == null || a == null) return inactive(def, "No form index recorded for one or both teams");

  const gap = Math.round((h - a) * 10) / 10;
  const abs = Math.abs(gap);

  // Zone thresholds and rates are the published form-gap figures. Samples
  // are null because no measured n exists for them yet — backtestSignals
  // already measures FORM5_DIFF9_* against real populations, and these rates
  // should be replaced by signal_backtests values once they clear the gate.
  let zone: string;
  let rate: number;
  let zoneSample: number;
  let zonePooled: boolean;
  if (abs > 30) {
    zone = "Banker"; rate = 75.7; zoneSample = 366; zonePooled = false;
  } else if (abs >= 15) {
    zone = "Strong"; rate = 72.6; zoneSample = 1893; zonePooled = true;
  } else if (abs >= 5) {
    zone = "Lean"; rate = 41.1; zoneSample = 1893; zonePooled = true;
  } else {
    zone = "Coin flip"; rate = 14.5; zoneSample = 1893; zonePooled = true;
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
    baseline: {
      rate,
      sample: zoneSample,
      pooled: zonePooled,
      label: "favourite wins in this zone",
      provenance: "unreplayed",
    },
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
  if (!band) return inactive(def, "Confidence band not yet computed for this fixture");

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
      ? {
          rate: row.rate,
          sample: row.sample,
          label: "favourite wins in this band",
          provenance: "unreplayed",
        }
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
  const tv = ctx.travel ?? null;
  // Prefer the view's own trip distance; fall back to match_intelligence so
  // the module still reads on fixtures the view has not covered.
  const km = num(tv?.away_trip_km) ?? ctx.match.intel?.away_travel_distance_km ?? null;
  const profile = tv?.travel_profile ?? null;

  if (km == null && profile == null)
    return inactive(def, "No travel distance recorded for this fixture");

  const BANDS = [
    { max: 100, label: "Minimal (<100km)", away: 28.6, home: 48.1, n: 77 },
    { max: 300, label: "Short (100–300km)", away: 26.3, home: 44.9, n: 167 },
    { max: 600, label: "Moderate (300–600km)", away: 26.0, home: 44.4, n: 169 },
    { max: Infinity, label: "Long (600km+)", away: 28.8, home: 42.3, n: 222 },
  ];
  const band = km != null ? BANDS.find((b) => km < b.max) ?? BANDS[3] : null;

  const PROFILES: Record<string, { status: ModuleStatus; label: string; verdict: string }> = {
    HOME_FRESH_ADVANTAGE: {
      status: "supports", label: "Home fresher",
      verdict: "Home team significantly fresher — supports home pick.",
    },
    AWAY_FRESH_ADVANTAGE: {
      status: "contradicts", label: "Away fresher",
      verdict: "Away team significantly fresher — contradicts home pick.",
    },
    AWAY_TRAVEL_FATIGUE: {
      status: "supports", label: "Away travel-fatigued",
      verdict: "Away side is carrying a heavy travel load — supports home pick.",
    },
    HOME_TRAVEL_FATIGUE: {
      status: "contradicts", label: "Home travel-fatigued",
      verdict: "Home side is carrying a heavy travel load — contradicts home pick.",
    },
    BOTH_TRAVEL_HEAVY: {
      status: "neutral", label: "Both travel-heavy",
      verdict: "Both teams travel-heavy — fatigue may affect both.",
    },
    NO_TRAVEL_EDGE: {
      status: "neutral", label: "No travel edge",
      verdict: "Neither team has significant travel burden — no edge.",
    },
  };
  const hit = profile ? PROFILES[profile] : null;

  // The profile is written from the home team's point of view, so backing the
  // away side inverts what "supports" means.
  let status: ModuleStatus = hit?.status ?? "neutral";
  if (hit && ctx.pickSide === "away") {
    if (status === "supports") status = "contradicts";
    else if (status === "contradicts") status = "supports";
  }

  const homeName = ctx.match.home.short_name || ctx.match.home.name;
  const awayName = ctx.match.away.short_name || ctx.match.away.name;
  const kmFmt = (v: number | null) =>
    v == null ? "—" : `${Math.round(v).toLocaleString()} km`;
  const load = (
    d7: number | null,
    d14: number | null,
    trips: number | null,
    fatigue: number | null
  ) => {
    const parts: string[] = [];
    if (d7 != null) parts.push(kmFmt(d7));
    if (trips != null) parts.push(`${trips} trip${trips === 1 ? "" : "s"}`);
    if (fatigue != null) parts.push(`fatigue ${Math.round(fatigue)}/100`);
    const head = parts.length ? parts.join(" · ") : "—";
    return d14 != null ? `${head} · 14d ${kmFmt(d14)}` : head;
  };

  const rows: ReadingRow[] = [];
  // Away side first: it is the one doing the travelling.
  rows.push({ label: `${awayName} today`, value: kmFmt(km), color: "var(--cool)" });
  rows.push({
    label: `${awayName} this week`,
    value: load(num(tv?.away_km_7d), num(tv?.away_km_14d), num(tv?.away_trips_7d), num(tv?.away_fatigue_score)),
  });
  rows.push({ label: `${homeName} today`, value: kmFmt(0), color: "var(--edge)" });
  rows.push({
    label: `${homeName} this week`,
    value: load(num(tv?.home_km_7d), num(tv?.home_km_14d), num(tv?.home_trips_7d), num(tv?.home_fatigue_score)),
  });
  const gap = num(tv?.travel_gap_7d);
  if (gap != null)
    rows.push({ label: "7d gap (away − home)", value: `${sign(Math.round(gap))} km` });
  if (profile)
    rows.push({ label: "Profile", value: profile, color: statusColor(status) });
  if (band) rows.push({ label: "Trip band", value: tv?.trip_band ?? band.label });

  return {
    def,
    status,
    headline: hit
      ? `${hit.label}${km != null ? ` · ${kmFmt(km)} trip` : ""}`
      : `${kmFmt(km)} · ${tv?.trip_band ?? band?.label ?? "Unclassified"}`,
    rows,
    baseline: band
      ? {
          rate: band.home,
          sample: band.n,
          label: "home wins in this distance band",
          provenance: "unreplayed",
        }
      : null,
    verdict:
      hit?.verdict ??
      "Away win rate moves under three points across every distance band — single-trip distance alone does not predict.",
  };
}

function evalRest(ctx: MatchModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.rest;
  const hr = ctx.match.intel?.home_rest_days ?? null;
  const ar = ctx.match.intel?.away_rest_days ?? null;
  if (hr == null || ar == null) return inactive(def, "Rest days not recorded for one or both teams");

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
    baseline: {
      rate: homeRate,
      sample: 1179,
      pooled: true,
      label: "home wins in this scenario",
      provenance: "unreplayed",
    },
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
  if (hr == null || ar == null) return inactive(def, "Rest days not recorded — fatigue split cannot be set");

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
    baseline: {
      rate,
      sample: 1179,
      pooled: true,
      label: "BTTS in this fatigue scenario",
      provenance: "unreplayed",
    },
    verdict:
      rate >= 58
        ? "A rested away side is the one fatigue split that meaningfully lifts BTTS."
        : "Spread across fatigue scenarios is under 3 points — weak on its own.",
  };
}

function evalCleanSheet(ctx: MatchModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.clean_sheet;
  const s = ctx.scoring;
  if (!s) return inactive(def, "Scoring probabilities not published for this fixture");

  // Clean sheet = the opponent fails to score. Derived from the concede rates
  // already carried by match_scoring_probabilities, WITH their samples.
  const homeConcedes = num(s.home_concedes_pct);
  const awayConcedes = num(s.away_concedes_pct);
  const homeCs = homeConcedes != null ? 100 - homeConcedes : null;
  const awayCs = awayConcedes != null ? 100 - awayConcedes : null;
  if (homeCs == null && awayCs == null) return inactive(def, "No concede rates recorded for either side");

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
  if (!ht) return inactive(def, "No half-time data available for this fixture");

  const options = [
    { k: "Home/Home", v: ht.hh_prob },
    { k: "Draw/Home", v: ht.dh_prob },
    { k: "Draw/Draw", v: ht.dd_prob },
    { k: "Away/Away", v: ht.aa_prob },
  ].filter((o) => o.v != null) as { k: string; v: number }[];
  if (options.length === 0) return inactive(def, "Half-time row exists but carries no HT/FT probabilities");

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

function evalWeather(ctx: MatchModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.weather;
  const w = ctx.match.weather ?? null;
  const temp = w?.temperature_c ?? null;
  const condition = w?.weather_condition ?? null;
  if (temp == null && !condition)
    return inactive(def, "No weather recorded for this fixture");

  const conditionLine = `${condition ?? "Unknown"}${temp != null ? ` · ${Math.round(temp)}°C` : ""}`;
  const rows: ReadingRow[] = [
    { label: "Condition", value: condition ?? "—" },
    { label: "Temperature", value: temp != null ? `${Math.round(temp)}°C` : "—" },
  ];
  if (w?.wind_speed_kmh != null)
    rows.push({ label: "Wind", value: `${Math.round(w.wind_speed_kmh)} km/h` });
  if (w?.humidity != null)
    rows.push({ label: "Humidity", value: `${Math.round(w.humidity)}%` });

  const cell = weatherCellFor(temp, condition);
  if (!cell) {
    rows.push({ label: "Profile", value: "None" });
    return {
      def,
      status: "neutral",
      headline: conditionLine,
      rows,
      baseline: null,
      verdict:
        "Conditions fall outside every measured weather profile — no effect to apply.",
    };
  }

  // Which metric this cell departs from the pooled rate on most. Computed,
  // not assigned, so the card follows the data if a cell is corrected.
  const pooled = weatherPooled();
  const metrics = [
    { key: "Over 2.5", rate: cell.over25Pct, base: pooled.over25Pct },
    { key: "BTTS", rate: cell.bttsPct, base: pooled.bttsPct },
    { key: "Home win", rate: cell.homeWinPct, base: pooled.homeWinPct },
  ];
  const lead = metrics.reduce((a, b) =>
    Math.abs(b.rate - b.base) > Math.abs(a.rate - a.base) ? b : a
  );

  const [lo, hi] = wilson(lead.rate, cell.sample);
  const separates = lo > lead.base || hi < lead.base;
  const calibrated = cell.sample >= WEATHER_MIN_SAMPLE;

  rows.push({ label: "Profile", value: cell.profile });
  rows.push({ label: "Avg goals", value: cell.avgGoals.toFixed(2) });
  rows.push({ label: "BTTS", value: `${cell.bttsPct.toFixed(1)}%` });
  rows.push({ label: "Over 2.5", value: `${cell.over25Pct.toFixed(1)}%` });
  rows.push({ label: "Home win", value: `${cell.homeWinPct.toFixed(1)}%` });

  const direction = lead.rate > lead.base ? "above" : "below";

  // Status only moves when the cell clears the sample gate AND its interval
  // clears the pooled rate. On the current table nothing does, so this stays
  // neutral rather than printing a directional call off single-digit samples.
  let verdict: string;
  let status: ModuleStatus = "neutral";
  if (!calibrated) {
    verdict =
      `${cell.profile}: ${lead.key} ran ${lead.rate.toFixed(1)}% against a pooled ` +
      `${lead.base.toFixed(1)}%, but on ${cell.sample} matches the 95% interval is ` +
      `${lo.toFixed(0)}–${hi.toFixed(0)}%. Below the ${WEATHER_MIN_SAMPLE}-match gate ` +
      `every other published rule has to clear, so this is context, not a signal.`;
  } else if (!separates) {
    verdict =
      `${cell.profile}: ${lead.key} at ${lead.rate.toFixed(1)}% is not separable from ` +
      `the pooled ${lead.base.toFixed(1)}% — the interval spans it.`;
  } else {
    status = lead.key === "Home win"
      ? (lead.rate > lead.base ? "supports" : "contradicts")
      : "supports";
    // A home-win effect argues against a pick on the away side.
    if (ctx.pickSide === "away" && lead.key === "Home win")
      status = status === "supports" ? "contradicts" : "supports";
    verdict =
      `${cell.profile}: ${lead.key} runs ${Math.abs(lead.rate - lead.base).toFixed(1)} points ` +
      `${direction} the pooled rate on ${cell.sample} matches (95% CI ${lo.toFixed(0)}–${hi.toFixed(0)}%).`;
  }

  return {
    def,
    status,
    headline: `${conditionLine} · ${cell.profile}`,
    rows,
    baseline: {
      rate: lead.rate,
      sample: cell.sample,
      label: `${lead.key} under ${cell.profile}`,
      baseRate: lead.base,
      provenance: "unreplayed",
    },
    verdict,
  };
}

function evalLeagueGoals(ctx: MatchModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.league_goals;
  const s = ctx.scoring;
  const leagueBtts = num(s?.league_btts_pct ?? null);
  const predTotal =
    (ctx.match.intel?.predicted_home_goals ?? 0) +
    (ctx.match.intel?.predicted_away_goals ?? 0);

  if (leagueBtts == null && !predTotal) return inactive(def, "No scoring profile published for this competition");

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


// ── Shared classifiers ───────────────────────────────────
// Both the single-team view (team page) and the two-sided view (match page)
// route through these, so the same underlying numbers can never be labelled
// two different ways on two different pages.

export function classifyVenue(hw: number, aw: number) {
  const disparity = Math.round((hw - aw) * 10) / 10;
  let type = "Neutral";
  if (hw >= 66 && aw <= 20) type = "Home reliant";
  else if (aw >= 66 && hw <= 20) type = "Road warrior";
  else if (hw >= 60 && aw >= 40) type = "All weather";
  return { type, disparity };
}

export type VenueEdge =
  | "HOME_VENUE_EDGE"
  | "AWAY_VENUE_EDGE"
  | "HOME_VENUE_LEAN"
  | "AWAY_VENUE_LEAN"
  | "NO_VENUE_EDGE";

/**
 * Venue edge for a specific fixture.
 *
 * `homeHomePct` is the home side's win rate AT HOME; `awayAwayPct` is the away
 * side's win rate ON THE ROAD. Comparing those two is what makes this
 * fixture-specific — classifying each team's overall profile in isolation was
 * why 0% at home against 67% away came back "no edge".
 */
export function classifyFixtureVenue(
  homeHomePct: number,
  awayAwayPct: number
): VenueEdge {
  if (homeHomePct >= 60 && awayAwayPct <= 20) return "HOME_VENUE_EDGE";
  if (awayAwayPct >= 60 && homeHomePct <= 20) return "AWAY_VENUE_EDGE";
  if (homeHomePct >= 50 && awayAwayPct <= 25) return "HOME_VENUE_LEAN";
  if (awayAwayPct >= 50 && homeHomePct <= 25) return "AWAY_VENUE_LEAN";
  return "NO_VENUE_EDGE";
}

export function classifyTrend(last5: number, prior5: number) {
  const change = last5 - prior5;
  const signed = change > 0 ? `+${change}` : `${change}`;
  // The label states the delta it is derived from. "Stable" alone read as a
  // judgement on the team; it only ever meant "this week matched last week",
  // which a side on 1 point from 15 games also satisfies.
  let base: string;
  if (change >= 10) base = "SURGING";
  else if (change <= -10) base = "CRASHING";
  else if (change >= 3) base = "IMPROVING";
  else if (change <= -3) base = "DECLINING";
  else base = "STABLE";
  const trend = base === "STABLE" ? "STABLE (no change)" : `${base} (${signed})`;
  return { trend, base, change, signed };
}

export function classifyConsistency(vol: number, oaf: number | null) {
  if (vol <= 0.6 && (oaf ?? 0) >= 70) return "Reliable strong";
  if (vol <= 0.6 && (oaf ?? 100) < 40) return "Reliable weak";
  if (vol <= 0.6) return "Predictable";
  if (vol >= 1.5) return "Erratic";
  return "Moderate";
}

export function classifyGiantKiller(
  gk: number | null,
  ftb: number | null,
  ppgTop: number | null
) {
  if ((gk ?? 0) >= 80) return "Strong vs top";
  if ((ftb ?? 0) >= 70) return "Flat-track bully";
  if ((ppgTop ?? 9) <= 0.5) return "Struggles vs top";
  return "Neutral";
}

/**
 * Prior-five points, derived from the two cumulative windows that
 * team_intelligence already carries. Avoids a team_momentum read on the match
 * page for a number that is already implied by data in hand.
 */
export function priorFiveFrom(
  last5: number | null | undefined,
  last10: number | null | undefined
): number | null {
  if (last5 == null || last10 == null) return null;
  const prior = last10 - last5;
  return prior >= 0 ? prior : null;
}

// ── Team-scope evaluators ────────────────────────────────

function evalHomeAway(ctx: TeamModuleContext): ModuleReading {
  const def = MODULE_BY_KEY.home_away;
  const v = ctx.venue;
  const hw = v?.home_win_pct ?? null;
  const aw = v?.away_win_pct ?? null;
  if (hw == null || aw == null) return inactive(def, "No home/away split recorded for this team");

  const { type, disparity } = classifyVenue(hw, aw);
  const hn = v?.home_matches ?? null;

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
    baseline: { rate: hw, sample: hn, label: "home wins" },
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
  if (last5 == null || prior5 == null) return inactive(def, "Not enough matches to compare two five-game windows");

  const { trend, change } = classifyTrend(last5, prior5);

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
  if (vol == null) return inactive(def, "Volatility not yet computed for this team");

  const oaf = q?.opponent_adjusted_form ?? null;
  const profile = classifyConsistency(vol, oaf);

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
  if (gk == null && ftb == null) return inactive(def, "Fewer than three fixtures against top-tier opposition");

  const profile = classifyGiantKiller(gk, ftb, q?.ppg_vs_top ?? null);

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
    evalWeather(ctx),
  ];
  return sortReadings(readings);
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
 * Overall confidence from the module spread.
 *
 * Contradictions are the primary gate; support count decides the rest.
 *   2+ contradictions            -> WEAK
 *   1 contradiction, any support -> MODERATE
 *   1 contradiction, no support  -> WEAK   (nothing argues for the pick and
 *                                           something argues against it —
 *                                           MODERATE would overstate that)
 *   0 contradictions, 2+ support -> STRONG
 *   0 contradictions, 1 support  -> MODERATE
 *   0 contradictions, no support -> NEUTRAL
 */
export function overallVerdict(t: ModuleTally): {
  label: "STRONG" | "MODERATE" | "NEUTRAL" | "WEAK" | "NO READ";
  color: string;
} {
  if (t.firing === 0) return { label: "NO READ", color: "var(--faint)" };
  if (t.contradicts >= 2) return { label: "WEAK", color: "var(--risk)" };
  if (t.contradicts === 1)
    return t.supports >= 1
      ? { label: "MODERATE", color: "var(--warn)" }
      : { label: "WEAK", color: "var(--risk)" };
  if (t.supports >= 2) return { label: "STRONG", color: "var(--edge)" };
  if (t.supports === 1) return { label: "MODERATE", color: "var(--warn)" };
  return { label: "NEUTRAL", color: "var(--muted)" };
}


// ── Ordering ─────────────────────────────────────────────
// Green, then amber, then red, then grey. Note this deliberately puts
// contradicting modules LAST; the verdict summary and the consensus cap are
// what keep a lone disagreement from being missed.
const STATUS_RANK: Record<ModuleStatus, number> = {
  supports: 0,
  neutral: 1,
  contradicts: 2,
  inactive: 3,
};

export function sortReadings(readings: ModuleReading[]): ModuleReading[] {
  return [...readings].sort(
    (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || a.def.n - b.def.n
  );
}

// ── Team modules, two-sided (match page) ─────────────────
// Same modules as the team page, but rendered as a head-to-head so a reader
// can see whether the pick side's standing profile actually helps in THIS
// fixture. Status is always judged relative to the pick side.

export interface MatchTeamSides {
  homeName: string;
  awayName: string;
  home: TeamModuleContext;
  away: TeamModuleContext;
  pickSide: "home" | "away" | null;
}

/** Status from "does the pick side hold the better profile here?" */
function sideStatus(
  pickSide: "home" | "away" | null,
  homeFavourable: boolean,
  awayFavourable: boolean
): ModuleStatus {
  if (pickSide == null) return "neutral";
  const pickOk = pickSide === "home" ? homeFavourable : awayFavourable;
  const oppOk = pickSide === "home" ? awayFavourable : homeFavourable;
  if (pickOk && !oppOk) return "supports";
  if (oppOk && !pickOk) return "contradicts";
  return "neutral";
}

const pts = (n: number) => `${n} ${n === 1 ? "pt" : "pts"}`;

const pickName = (s: MatchTeamSides) =>
  s.pickSide === "home" ? s.homeName : s.pickSide === "away" ? s.awayName : null;

function evalHomeAwayMatch(s: MatchTeamSides): ModuleReading {
  const def = MODULE_BY_KEY.home_away;
  const hv = s.home.venue;
  const av = s.away.venue;
  const hHome = hv?.home_win_pct ?? null;
  const aAway = av?.away_win_pct ?? null;
  if (hHome == null || aAway == null)
    return inactive(def, "No home/away split recorded for one or both teams");

  const edge = classifyFixtureVenue(hHome, aAway);
  const hn = hv?.home_matches ?? null;
  const an = av?.away_matches ?? null;

  const favours: "home" | "away" | null =
    edge === "HOME_VENUE_EDGE" || edge === "HOME_VENUE_LEAN"
      ? "home"
      : edge === "AWAY_VENUE_EDGE" || edge === "AWAY_VENUE_LEAN"
        ? "away"
        : null;

  const status: ModuleStatus =
    favours == null || s.pickSide == null
      ? "neutral"
      : favours === s.pickSide
        ? "supports"
        : "contradicts";

  const VERDICTS: Record<VenueEdge, string> = {
    HOME_VENUE_EDGE: `HOME_VENUE_EDGE — ${s.homeName} dominates at home.`,
    AWAY_VENUE_EDGE: `AWAY_VENUE_EDGE — ${s.awayName} strong on the road.`,
    HOME_VENUE_LEAN: `HOME_VENUE_LEAN — slight home advantage.`,
    AWAY_VENUE_LEAN: `AWAY_VENUE_LEAN — slight away advantage.`,
    NO_VENUE_EDGE: `NO_VENUE_EDGE — neither side's venue habit gives an edge.`,
  };

  return {
    def,
    status,
    code: edge,
    headline: `${s.homeName} ${hHome.toFixed(0)}% home · ${s.awayName} ${aAway.toFixed(0)}% away`,
    rows: [
      {
        label: `${s.homeName} at home`,
        value: `${hHome.toFixed(0)}%${hn ? ` (n=${hn})` : ""}`,
        color: "var(--edge)",
      },
      {
        label: `${s.awayName} away`,
        value: `${aAway.toFixed(0)}%${an ? ` (n=${an})` : ""}`,
        color: "var(--cool)",
      },
      { label: "Edge", value: edge, color: statusColor(status) },
    ],
    baseline:
      favours === "away"
        ? { rate: aAway, sample: an, label: `${s.awayName} away wins` }
        : { rate: hHome, sample: hn, label: `${s.homeName} home wins` },
    verdict: VERDICTS[edge],
  };
}

function evalReadinessMatch(s: MatchTeamSides): ModuleReading {
  const def = MODULE_BY_KEY.readiness;
  const h5 = s.home.intel?.last_5_points ?? null;
  const a5 = s.away.intel?.last_5_points ?? null;
  const hPrior = priorFiveFrom(h5, s.home.intel?.last_10_points);
  const aPrior = priorFiveFrom(a5, s.away.intel?.last_10_points);
  if (h5 == null || a5 == null || hPrior == null || aPrior == null)
    return inactive(def, "Not enough matches to compare two five-game windows");

  const hc = classifyTrend(h5, hPrior);
  const ac = classifyTrend(a5, aPrior);
  const status = sideStatus(
    s.pickSide,
    hc.change >= 3 && hc.change > ac.change,
    ac.change >= 3 && ac.change > hc.change
  );

  return {
    def,
    status,
    code: s.pickSide === "away" ? ac.base : hc.base,
    headline: `${s.homeName}: ${hc.trend} · ${s.awayName}: ${ac.trend}`,
    rows: [
      { label: `${s.homeName} last 5`, value: `${h5} pts` },
      { label: `${s.homeName} prior 5`, value: `${hPrior} pts` },
      { label: `${s.homeName} change`, value: sign(hc.change) },
      { label: `${s.awayName} last 5`, value: `${a5} pts` },
      { label: `${s.awayName} prior 5`, value: `${aPrior} pts` },
      { label: `${s.awayName} change`, value: sign(ac.change) },
    ],
    baseline: null,
    // The points are stated alongside the label so "STABLE" cannot be read as
    // a comment on quality when it only describes week-over-week change.
    verdict:
      `${s.homeName}: ${hc.trend} — ${pts(h5)} from last 5 matches. ` +
      `${s.awayName}: ${ac.trend} — ${pts(a5)} from last 5 matches.`,
  };
}

function evalConsistencyMatch(s: MatchTeamSides): ModuleReading {
  const def = MODULE_BY_KEY.consistency;
  const hq = s.home.formQuality;
  const aq = s.away.formQuality;
  const hv = hq?.volatility ?? null;
  const av = aq?.volatility ?? null;
  if (hv == null || av == null)
    return inactive(def, "Volatility not yet computed for one or both teams");

  const hp = classifyConsistency(hv, hq?.opponent_adjusted_form ?? null);
  const ap = classifyConsistency(av, aq?.opponent_adjusted_form ?? null);
  const status = sideStatus(s.pickSide, hv <= 0.6, av <= 0.6);
  const hn = hq?.window_matches ?? null;
  const an = aq?.window_matches ?? null;

  return {
    def,
    status,
    headline: `${s.homeName}: ${hp} · ${s.awayName}: ${ap}`,
    rows: [
      { label: `${s.homeName} volatility`, value: `${hv.toFixed(2)}${hn ? ` (n=${hn})` : ""}` },
      { label: `${s.awayName} volatility`, value: `${av.toFixed(2)}${an ? ` (n=${an})` : ""}` },
      { label: `${s.homeName} profile`, value: hp },
      { label: `${s.awayName} profile`, value: ap },
    ],
    baseline: null,
    verdict:
      status === "supports"
        ? `${pickName(s)} is the more repeatable side — form-based reads hold up better against them.`
        : status === "contradicts"
          ? `${pickName(s) ?? "The pick"} swings match to match while the opponent does not.`
          : "Both sides are similarly repeatable.",
  };
}

function evalGiantKillerMatch(s: MatchTeamSides): ModuleReading {
  const def = MODULE_BY_KEY.giant_killer;
  const hq = s.home.formQuality;
  const aq = s.away.formQuality;
  const hgk = hq?.giant_killer_score ?? null;
  const agk = aq?.giant_killer_score ?? null;
  if (hgk == null && agk == null)
    return inactive(def, "Fewer than three fixtures against top-tier opposition");

  const hp = classifyGiantKiller(hgk, hq?.flat_track_bully_score ?? null, hq?.ppg_vs_top ?? null);
  const ap = classifyGiantKiller(agk, aq?.flat_track_bully_score ?? null, aq?.ppg_vs_top ?? null);
  const status = sideStatus(s.pickSide, hp === "Strong vs top", ap === "Strong vs top");
  const hn = hq?.matches_vs_top ?? null;
  const an = aq?.matches_vs_top ?? null;

  return {
    def,
    status,
    headline: `${s.homeName}: ${hp} · ${s.awayName}: ${ap}`,
    rows: [
      { label: `${s.homeName} vs top`, value: hq?.ppg_vs_top != null ? `${hq.ppg_vs_top.toFixed(2)} ppg${hn ? ` (n=${hn})` : ""}` : "—" },
      { label: `${s.awayName} vs top`, value: aq?.ppg_vs_top != null ? `${aq.ppg_vs_top.toFixed(2)} ppg${an ? ` (n=${an})` : ""}` : "—" },
      { label: `${s.homeName} profile`, value: hp },
      { label: `${s.awayName} profile`, value: ap },
    ],
    baseline: null,
    verdict:
      status === "supports"
        ? `${pickName(s)} raises its level against stronger opposition.`
        : status === "contradicts"
          ? "The opponent is the side that steps up against better teams."
          : "Neither side shows a clear tier effect.",
  };
}

export function evaluateTeamModulesForMatch(s: MatchTeamSides): ModuleReading[] {
  return [
    evalHomeAwayMatch(s),
    evalReadinessMatch(s),
    evalConsistencyMatch(s),
    evalGiantKillerMatch(s),
  ];
}

/** All twelve modules for a fixture: eight match-scope plus four team-scope. */
export function evaluateAllMatchModules(
  ctx: MatchModuleContext,
  sides?: MatchTeamSides
): ModuleReading[] {
  const matchLevel = evaluateMatchModules(ctx);
  const teamLevel = sides ? evaluateTeamModulesForMatch(sides) : [];
  return sortReadings([...matchLevel, ...teamLevel]);
}
