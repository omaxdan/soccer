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

// ─────────────────────────────────────────────────────────────────────────────
// Minimum sample policy
//
// Before this, three unrelated numeric conventions already existed for "is
// this enough data": SAMPLE_GATE_HEADLINE/PROVISIONAL (30/10, sample size for
// a league's hit-rate percentage) in archiveReadinessHistory.ts, MIN_SAMPLE
// (200) in backtestConfidenceBands.ts and backtestSignals.ts, and
// MIN_POPULATION (5) in processDbOnly.ts's NBSI z-score population floor.
// None of them shared a definition of what to DO below threshold, and each
// was invented independently by whoever wrote that processor.
//
// Centralizing does NOT mean collapsing these to one number — 5 teams for a
// population mean/stddev, 30 result-linked matches to trust a league's hit
// rate, and 200 samples to declare a confidence band calibrated are
// genuinely different statistical claims with genuinely different sample
// requirements. What's shared here is the POLICY: given a sample size and
// the threshold appropriate to the claim being made, return one consistent
// answer about what a caller may say, so "insufficient data" means the same
// thing and gets the same treatment everywhere it's decided, rather than
// each processor inventing its own suppression logic ad hoc.
export type SampleQuality = 'insufficient' | 'limited' | 'adequate';

export interface SampleThresholds {
  /** Below this: no classification is defensible. Return 'insufficient'. */
  minimum: number;
  /** Below this (but >= minimum): defensible but should read as provisional. */
  provisional: number;
}

/** Named presets matching this codebase's own existing, already-proven conventions — not new numbers invented for this helper. */
export const SAMPLE_THRESHOLDS = {
  /** A league/team hit-rate percentage. Matches archiveReadinessHistory.ts's existing SAMPLE_GATE_HEADLINE/PROVISIONAL. */
  historicalRate: { minimum: 10, provisional: 30 } as SampleThresholds,
  /** A z-score population mean/stddev. Matches processDbOnly.ts's existing NBSI MIN_POPULATION. */
  population: { minimum: 5, provisional: 5 } as SampleThresholds,
  /** A calibration/backtest gate strong enough to publish. Matches backtestConfidenceBands.ts / backtestSignals.ts's existing MIN_SAMPLE. */
  calibration: { minimum: 50, provisional: 200 } as SampleThresholds,
  /** Team/venue/head-to-head form claims — the new case this centralization exists to cover, not yet enforced anywhere. */
  formClaim: { minimum: 3, provisional: 5 } as SampleThresholds,
} as const;

export function sampleQuality(n: number, thresholds: SampleThresholds): SampleQuality {
  if (n < thresholds.minimum) return 'insufficient';
  if (n < thresholds.provisional) return 'limited';
  return 'adequate';
}

/**
 * True only when a caller may state a strong/elite-tier classification.
 * 'limited' data may still show a number — just not a confident one; this is
 * the boundary between "show it, caveated" and "make a strong claim from it".
 */
export function canClassifyStrongly(n: number, thresholds: SampleThresholds): boolean {
  return sampleQuality(n, thresholds) === 'adequate';
}


//
// The one place a readiness_history row becomes a scored, banded outcome, and
// the one place a group of them becomes a hit-rate/lift/interval statistic.
// Before this existed, jobs/archiveReadinessHistory.ts walked
// readiness_history with its own derivePick()/DRAW_GAP_BAND and its own
// tier-bucketing, while jobs/backtestConfidenceBands.ts walked the SAME table
// with the real derivePick()/bandFor()/wilson() and a different lift formula.
// Both are now callers of scoreHistoricalRows() + summariseHistoricalRows().
//
//   readiness_history
//         │
//         ▼
//   scoreHistoricalRows()   — one row in, one ScoredHistoryRow out, or a
//                              recorded rejection. Nothing downstream ever
//                              re-derives a pick or a band from raw columns.
//         │
//         ▼
//   summariseHistoricalRows(rows, groupKey, options)
//         │
//         ├─ groupKey = r => r.band                       → platform stats
//         └─ groupKey = r => `${r.leagueName}::${r.band}`  → league × band cells
// ─────────────────────────────────────────────────────────────────────────────

/** What a caller selects from readiness_history before handing rows here. */
export interface RawFrozenRow {
  matchId: number;
  leagueName: string;
  snapshotAt: string | null;
  matchDate: string | null;
  confidencePct: number | null;
  predictedGap: number | null;
  predictedPick: string | null;
  finalOutcome: string | null;
  pickCorrectStrict: boolean | null;
  pickCorrectLenient: boolean | null;
  /** Optional — not every league/tier has this tracked. Absence means "not available", never zero. */
  squadVersatility: number | null;
}

export interface ScoredHistoryRow {
  matchId: number;
  leagueName: string;
  band: ConfidenceBand;
  score: number;
  predictedGap: number;
  pick: Pick;
  outcome: Pick;
  strict: boolean;
  lenient: boolean;
  squadVersatility: number | null;
}

export interface ScoreRejections {
  /** snapshot_at missing/null, match_date missing/null, or snapshot_at >= match_date. */
  notPreKickoff: number;
  /** Result not yet linked, or a required column is null. */
  missingFields: number;
  /** confidence_pct present but out of bandFor()'s domain (should not occur; recorded, not assumed impossible). */
  noBand: number;
}

/**
 * Turns raw readiness_history rows into scored, banded outcomes.
 *
 * The defensive `snapshot_at < match_date` re-check — previously only inside
 * backtestConfidenceBands.ts's FROZEN mode — runs here unconditionally, so
 * every caller of this function gets it, including the league aggregation
 * that previously trusted the table's write-time contract without re-
 * verifying it. A row failing this is dropped and counted, never assumed
 * valid because it "should" be.
 */
export function scoreHistoricalRows(
  rows: RawFrozenRow[]
): { scored: ScoredHistoryRow[]; rejected: ScoreRejections } {
  const scored: ScoredHistoryRow[] = [];
  const rejected: ScoreRejections = { notPreKickoff: 0, missingFields: 0, noBand: 0 };

  for (const r of rows) {
    const snapTs = r.snapshotAt ? new Date(r.snapshotAt).getTime() : null;
    const kickTs = r.matchDate ? new Date(r.matchDate).getTime() : null;
    if (snapTs == null || kickTs == null || snapTs >= kickTs) {
      rejected.notPreKickoff++;
      continue;
    }
    if (
      r.confidencePct == null || r.predictedGap == null || !r.predictedPick ||
      !r.finalOutcome || r.pickCorrectStrict == null || r.pickCorrectLenient == null
    ) {
      rejected.missingFields++;
      continue;
    }
    const band = bandFor(Number(r.confidencePct));
    if (!band) {
      rejected.noBand++;
      continue;
    }
    scored.push({
      matchId: r.matchId,
      leagueName: r.leagueName,
      band,
      score: Number(r.confidencePct),
      predictedGap: Number(r.predictedGap),
      pick: r.predictedPick as Pick,
      outcome: r.finalOutcome as Pick,
      strict: r.pickCorrectStrict === true,
      lenient: r.pickCorrectLenient === true,
      squadVersatility: r.squadVersatility,
    });
  }
  return { scored, rejected };
}

export interface GroupStat {
  /** Whatever groupKey() returned for this group — the caller parses it back. */
  key: string;
  n: number;
  hits: number;
  rate: number;
  rateLenient: number;
  ciLow: number;
  ciHigh: number;
  baseline: number;
  /** Internal only. Never persisted or displayed — see liftPct. */
  liftRatio: number;
  /**
   * (liftRatio - 1) * 100, e.g. rate 48% over baseline 40% -> ratio 1.20 ->
   * liftPct +20. This, not liftRatio, is what league_gap_analytics/summary
   * store: an explicit product decision that the public meaning of
   * lift_over_baseline (a signed percentage) must not change even though the
   * statistic computed internally is now a ratio. signal_backtests.lift is
   * untouched by this — it has no frontend consumer today and keeps storing
   * the ratio it always has.
   */
  liftPct: number;
  calibrated: boolean;
}

/**
 * Generic over any row shape carrying at least strict/lenient — the function
 * only ever reads those two fields plus whatever groupKey()/baselineOf()
 * themselves choose to read from a row, which the caller supplies. This is
 * what lets archiveReadinessHistory.ts's richer ScoredHistoryRow (leagueName,
 * predictedGap, squadVersatility) and backtestConfidenceBands.ts's narrower
 * Scored (no league — RECONSTRUCTED/CURRENT populations are not built from
 * readiness_history) share the exact same aggregation function without
 * forcing an artificial shape match between two genuinely different row
 * types that happen to both need "group, count hits, Wilson, lift".
 */
export interface HitRow {
  strict: boolean;
  lenient: boolean;
}

export function summariseHistoricalRows<T extends HitRow>(
  rows: T[],
  groupKey: (r: T) => string,
  options: {
    minSample: number;
    minLift: number;
    baselineOf: (representative: T, allRows: T[]) => number;
  }
): GroupStat[] {
  const groups = new Map<string, T[]>();
  for (const r of rows) {
    const key = groupKey(r);
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }

  const out: GroupStat[] = [];
  for (const [key, group] of groups) {
    const n = group.length;
    const hits = group.filter(r => r.strict).length;
    const rate = n > 0 ? hits / n : 0;
    const [ciLow, ciHigh] = wilson(hits, n);
    const baseline = options.baselineOf(group[0], rows);
    const liftRatio = baseline > 0 ? rate / baseline : 0;
    out.push({
      key, n, hits, rate,
      rateLenient: n > 0 ? group.filter(r => r.lenient).length / n : 0,
      ciLow, ciHigh, baseline, liftRatio,
      liftPct: Math.round((liftRatio - 1) * 1000) / 10,
      calibrated: n >= options.minSample && liftRatio >= options.minLift,
    });
  }
  return out;
}

/** Strict hit-rate over an arbitrary pool of already-scored rows. Used to build baselineOf callbacks. */
export function strictRate(rows: HitRow[]): number {
  if (rows.length === 0) return 0;
  return rows.filter(r => r.strict).length / rows.length;
}
