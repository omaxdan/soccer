/**
 * CONFIDENCE BAND — single definition, shared by the live writer and the
 * backtest harness.
 *
 * Same discipline as SIGNAL_RULES in backtestSignals.ts: the thing being
 * measured must be byte-identical to the thing being published. Before this
 * file existed, the band thresholds lived inline in processDbOnly.ts and
 * nothing else could reference them without retyping — which is exactly how a
 * backtest ends up measuring a rule the product does not actually ship.
 *
 * IMPORT THIS. Do not re-declare thresholds anywhere.
 */

export type ConfidenceBand = 'Elite' | 'Strong' | 'Moderate' | 'Risky' | 'Avoid';

export const BAND_ORDER: ConfidenceBand[] = [
  'Elite',
  'Strong',
  'Moderate',
  'Risky',
  'Avoid',
];

/** Lower bound (inclusive) of each band on the 0–100 confidence score. */
export const BAND_FLOOR: Record<ConfidenceBand, number> = {
  Elite: 95,
  Strong: 85,
  Moderate: 70,
  Risky: 55,
  Avoid: 0,
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
  const rawGap = homeReadiness - awayReadiness;
  if (Math.abs(rawGap) <= DRAW_GAP_BAND) return { pick: 'DRAW', gap: rawGap };
  if (rawGap > 0) return { pick: 'HOME', gap: rawGap };
  return { pick: 'AWAY', gap: Math.abs(rawGap) };
}

export function outcomeOf(homeScore: number, awayScore: number): Pick {
  if (homeScore > awayScore) return 'HOME';
  if (homeScore < awayScore) return 'AWAY';
  return 'DRAW';
}

/**
 * The eight evidence components the confidence score blends, with the
 * saturation constant and weight used by processDbOnly.ts.
 *
 * `archivable` records whether a pre-kickoff historical value for that
 * component exists ANYWHERE in the warehouse today. This is not decoration:
 * six of eight are current-state only, which is precisely why a full-fidelity
 * historical backtest of the published band is impossible until migration 033
 * has accumulated forward data. The backtest reads this table to report which
 * components it was able to reconstruct.
 */
export interface BandComponentSpec {
  key: string;
  label: string;
  saturation: number;
  weight: number;
  /** Source that carries a genuine pre-kickoff value, or null if none exists. */
  archivedSource: string | null;
}

export const BAND_COMPONENTS: BandComponentSpec[] = [
  {
    key: 'readiness_gap',
    label: 'Readiness gap',
    saturation: 30,
    weight: 30,
    archivedSource: 'readiness_history.home_readiness / away_readiness',
  },
  {
    key: 'strength_gap',
    label: 'Strength gap',
    saturation: 30,
    weight: 20,
    // team_strength_ratings is current-only; snapshots record this honestly
    // as NULL for backfilled matches.
    archivedSource: null,
  },
  {
    key: 'injury_gap',
    label: 'Injury burden gap',
    saturation: 40,
    weight: 15,
    archivedSource: null,
  },
  {
    key: 'congestion_gap',
    label: 'Congestion gap',
    saturation: 50,
    weight: 10,
    archivedSource: null,
  },
  {
    key: 'travel_gap',
    label: 'Travel gap (km)',
    saturation: 1500,
    weight: 10,
    // Stadium-to-stadium distance is geography, not form. It does not move
    // with results, so reading it retrospectively is not leakage.
    archivedSource: 'match_intelligence.home/away_travel_distance_km',
  },
  {
    key: 'stability_gap',
    label: 'Squad stability gap',
    saturation: 40,
    weight: 5,
    archivedSource: null,
  },
  {
    key: 'venue_gap',
    label: 'Venue advantage gap',
    saturation: 40,
    weight: 7,
    // Season-cumulative venue record — contains the match being scored.
    archivedSource: null,
  },
  {
    key: 'motivation_gap',
    label: 'Motivation proxy gap',
    saturation: 20,
    weight: 3,
    archivedSource: null,
  },
];

export const ARCHIVABLE_WEIGHT = BAND_COMPONENTS.filter(
  (c) => c.archivedSource !== null
).reduce((s, c) => s + c.weight, 0);

export const TOTAL_WEIGHT = BAND_COMPONENTS.reduce((s, c) => s + c.weight, 0);

/** Minimum components with data before a score is emitted at all. */
export const MIN_COMPONENTS_WITH_DATA = 4;

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
