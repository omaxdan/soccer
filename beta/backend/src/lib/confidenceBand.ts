/**
 * CONFIDENCE BAND — single definition, shared by the live writer and the
 * backtest harness.
 *
 * Same discipline as SIGNAL_RULES in backtestSignals.ts: the thing being
 * measured must be byte-identical to the thing being published. Before this
 * file existed, the band thresholds and the score blend lived inline in
 * processDbOnly.ts and nothing else could reference them without retyping —
 * which is how a backtest ends up measuring a rule the product does not ship.
 *
 * IMPORT THIS. Do not re-declare thresholds or re-implement the blend.
 */

export type ConfidenceBand = 'Elite' | 'Strong' | 'Moderate' | 'Risky' | 'Avoid';

export const BAND_ORDER: ConfidenceBand[] = [
  'Elite', 'Strong', 'Moderate', 'Risky', 'Avoid',
];

/** Lower bound (inclusive) of each band on the 0-100 confidence score. */
export const BAND_FLOOR: Record<ConfidenceBand, number> = {
  Elite: 95, Strong: 85, Moderate: 70, Risky: 55, Avoid: 0,
};

export function bandFor(score: number | null | undefined): ConfidenceBand | null {
  if (score == null || Number.isNaN(score)) return null;
  if (score >= BAND_FLOOR.Elite) return 'Elite';
  if (score >= BAND_FLOOR.Strong) return 'Strong';
  if (score >= BAND_FLOOR.Moderate) return 'Moderate';
  if (score >= BAND_FLOOR.Risky) return 'Risky';
  return 'Avoid';
}

/** Readiness gap magnitude at or below which the pick is DRAW, not a side. */
export const DRAW_GAP_BAND = 3;

export type Pick = 'HOME' | 'AWAY' | 'DRAW';

export function derivePick(
  homeReadiness: number | null | undefined,
  awayReadiness: number | null | undefined
): { pick: Pick | null; gap: number | null } {
  if (homeReadiness == null || awayReadiness == null) return { pick: null, gap: null };
  const rawGap = Number(homeReadiness) - Number(awayReadiness);
  if (Math.abs(rawGap) <= DRAW_GAP_BAND) return { pick: 'DRAW', gap: rawGap };
  if (rawGap > 0) return { pick: 'HOME', gap: rawGap };
  return { pick: 'AWAY', gap: Math.abs(rawGap) };
}

export function outcomeOf(homeScore: number, awayScore: number): Pick {
  if (homeScore > awayScore) return 'HOME';
  if (homeScore < awayScore) return 'AWAY';
  return 'DRAW';
}

// -- Component spec ---------------------------------------------------------

export type ComponentKey =
  | 'readiness_gap' | 'strength_gap' | 'injury_gap' | 'congestion_gap'
  | 'travel_gap' | 'stability_gap' | 'venue_gap' | 'motivation_gap';

export interface BandComponentSpec {
  key: ComponentKey;
  label: string;
  saturation: number;
  weight: number;
  /**
   * A table carrying a genuine PRE-KICKOFF value for this component, or null
   * if the warehouse only holds current state.
   *
   * Load-bearing, not documentation. Anything with a source here can be
   * reconstructed for a historical match without leakage; anything null
   * cannot be reconstructed at all and is renormalised out, exactly as the
   * live blend does when a component is missing.
   */
  archivedSource: string | null;
}

export const BAND_COMPONENTS: BandComponentSpec[] = [
  {
    key: 'readiness_gap', label: 'Readiness gap', saturation: 30, weight: 30,
    // Two independent pre-kickoff sources: the per-match replay snapshot and
    // the immutable archive written before kickoff.
    archivedSource: 'team_match_snapshots.readiness_before / readiness_history.home_readiness',
  },
  {
    key: 'strength_gap', label: 'Strength gap', saturation: 30, weight: 20,
    // team_strength_ratings is one row per team, current only. Migration 030
    // records this honestly: strength_rating_before is NULL for backfills.
    archivedSource: null,
  },
  {
    key: 'injury_gap', label: 'Injury burden gap', saturation: 40, weight: 15,
    archivedSource: 'team_intelligence_history.injury_burden_score',
  },
  {
    key: 'congestion_gap', label: 'Congestion gap', saturation: 50, weight: 10,
    archivedSource: 'team_intelligence_history.congestion_score',
  },
  {
    key: 'travel_gap', label: 'Travel gap (cumulative fatigue)', saturation: 40, weight: 10,
    // Was match_travel_intelligence distance-to-this-venue at saturation 1500.
    // That column forces a true home match to 0 by design, so it described the
    // trip rather than the fatigue, and a home side fresh off two away trips
    // scored as untravelled. Now the same cumulative figure readiness uses.
    // Saturation follows the unit change from kilometres to a 0-100 score.
    archivedSource: 'team_intelligence_history.travel_fatigue_score',
  },
  {
    key: 'stability_gap', label: 'Squad stability gap', saturation: 40, weight: 5,
    archivedSource: 'team_intelligence_history.squad_stability_score',
  },
  {
    key: 'venue_gap', label: 'Venue advantage gap', saturation: 40, weight: 7,
    // team_venue_performance is season-cumulative and current-only - it
    // contains the match being scored.
    archivedSource: null,
  },
  {
    key: 'motivation_gap', label: 'Motivation proxy gap', saturation: 20, weight: 3,
    // team_motivation is one row per team, current only.
    archivedSource: null,
  },
];

export const COMPONENT_BY_KEY: Record<ComponentKey, BandComponentSpec> =
  BAND_COMPONENTS.reduce((a, c) => ({ ...a, [c.key]: c }), {} as Record<ComponentKey, BandComponentSpec>);

export const ARCHIVABLE_COMPONENTS = BAND_COMPONENTS.filter(c => c.archivedSource !== null);
export const ARCHIVABLE_WEIGHT = ARCHIVABLE_COMPONENTS.reduce((s, c) => s + c.weight, 0);
export const TOTAL_WEIGHT = BAND_COMPONENTS.reduce((s, c) => s + c.weight, 0);

/** Minimum components with data before a score is emitted at all. */
export const MIN_COMPONENTS_WITH_DATA = 4;

// -- The blend --------------------------------------------------------------

export interface ScoreResult {
  score: number;
  band: ConfidenceBand;
  componentsWithData: number;
  weightUsed: number;
  /** Normalised edge actually used per component, for attribution. */
  edges: Partial<Record<ComponentKey, number>>;
}

/**
 * Blend evidence components into a 0-100 confidence score.
 *
 * `gapsTowardHome` holds each component's RAW gap signed toward the home side
 * (null when unavailable). `pickSign` is +1 for a home pick, -1 for away.
 * Each gap is signed toward the pick, clamped to [-1, 1] at its saturation
 * constant, then weight-blended. Missing components renormalise rather than
 * counting as negative evidence - same discipline as computeReadiness.
 *
 * Returns null below MIN_COMPONENTS_WITH_DATA, matching processDbOnly's gate:
 * a score built from the readiness gap alone would just restate the gap with
 * false precision.
 */
export function computeConfidenceScore(
  gapsTowardHome: Partial<Record<ComponentKey, number | null>>,
  pickSign: 1 | -1
): ScoreResult | null {
  let weightedSum = 0;
  let weightUsed = 0;
  let componentsWithData = 0;
  const edges: Partial<Record<ComponentKey, number>> = {};

  for (const spec of BAND_COMPONENTS) {
    const gap = gapsTowardHome[spec.key];
    if (gap == null || Number.isNaN(gap)) continue;
    const edge = Math.max(-1, Math.min(1, (gap * pickSign) / spec.saturation));
    edges[spec.key] = edge;
    weightedSum += edge * spec.weight;
    weightUsed += spec.weight;
    componentsWithData++;
  }

  if (componentsWithData < MIN_COMPONENTS_WITH_DATA || weightUsed === 0) return null;

  const score = Math.round(
    Math.max(0, Math.min(100, 50 + 50 * (weightedSum / weightUsed))) * 10
  ) / 10;

  return { score, band: bandFor(score)!, componentsWithData, weightUsed, edges };
}

/** Wilson score interval, returned as percentages. */
export function wilson(hits: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 100];
  const p = hits / n;
  const denom = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [
    Math.max(0, ((centre - spread) / denom) * 100),
    Math.min(100, ((centre + spread) / denom) * 100),
  ];
}
