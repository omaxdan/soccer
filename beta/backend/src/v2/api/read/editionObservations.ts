// ─────────────────────────────────────────────────────────────────────────────
// EDITION MATCH-PERFORMANCE OBSERVATIONS — read model (descriptive, chronological)
//
// Answers ONLY "how has this edition's football/results environment developed
// over time?". A league-wide, cumulative, chronological projection over the
// EXISTING substrate:
//   football.fixture             — eligibility (COMPLETED), kickoff, edition, sides
//   football.result              — goals (full-edition W/D/L, goals, clean sheets)
//   football.team_match_statistic — per-fixture team stats (ALL period), BOTH sides
//     summed into league-wide stat totals (enriched-cohort coverage)
//
// It computes NOTHING interpretive: no trend, no per-90, no "improving/regressing",
// no prediction, no composite score, no table position. It is edition-wide, one
// cumulative point per completed fixture — NOT per team, NOT per round/matchday
// (football.fixture has no reliable round field; competition_stage is optional
// group/knockout structure).
//
// Two coverage tiers, kept strictly distinct (mandatory):
//   • RESULT TIER  — full-edition, from fixture + result (every completed fixture).
//   • STAT TIER    — enriched-cohort, from team_match_statistic (only the fixtures
//     that carry stats). Each stat metric reports its own eligible/with-metric
//     coverage; a ~38-of-250 total is NEVER presented as whole-league truth.
//
// Semantics locked by the approved specification:
//   • GRAIN — cumulative edition state after each eligible completed fixture,
//     ordered (scheduled_kickoff_at ASC, fixture_id ASC). Canonical sequenceIndex
//     1..n is assigned in chronological order and PRESERVED even when order=desc /
//     limit / offset reshape the emitted series.
//   • STRICT as_of — `scheduled_kickoff_at < asOf` (never <=); never calculated_at.
//   • MISSING ≠ ZERO — a fixture without team stats still counts for result metrics
//     but contributes nothing to stat totals; an absent stat is null, never 0.
//   • BOTH SIDES — edition stat totals sum home_value + away_value (no target team).
//   • GROUP DEDUP — one row per (fixture, statistic_key) at ALL period, smallest
//     group_name; duplicate groups must agree on BOTH home_value and away_value or
//     a data-integrity condition is raised (never a silent pick).
//   • AGGREGATE BEFORE SLICE — the full cumulative series is built over ALL eligible
//     fixtures; order/limit/offset apply only to the emitted series; `current` is
//     always the final eligible point.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

// ── stat-tier metric definitions ────────────────────────────────────────────────
// Each output metric maps to one or more underlying team_match_statistic keys
// (all confirmed present in the Team Observation canonical vocabulary). A metric's
// per-fixture value is the sum of every present numeric contribution across the
// mapped keys × both sides; `shots` is composed as shotsOnGoal + shotsOffGoal, and
// `shotsOnTarget` is shotsOnGoal (the single documented definition — §8).

export interface EditionStatMetricDef {
  readonly key: string;              // output metric key
  readonly sources: readonly string[]; // underlying team_match_statistic keys
}

export const EDITION_STAT_METRICS: readonly EditionStatMetricDef[] = [
  { key: 'expectedGoals', sources: ['expectedGoals'] },
  { key: 'shots', sources: ['shotsOnGoal', 'shotsOffGoal'] },
  { key: 'shotsOnTarget', sources: ['shotsOnGoal'] },
  { key: 'yellowCards', sources: ['yellowCards'] },
  { key: 'redCards', sources: ['redCards'] },
  { key: 'fouls', sources: ['fouls'] },
  { key: 'kilometersCovered', sources: ['kilometersCovered'] },
  { key: 'numberOfSprints', sources: ['numberOfSprints'] },
] as const;

/** The union of underlying keys Query B must fetch. */
export const EDITION_STAT_SOURCE_KEYS: readonly string[] = [
  ...new Set(EDITION_STAT_METRICS.flatMap((m) => m.sources)),
];

// ── wire DTOs ───────────────────────────────────────────────────────────────────

export type EditionResultCoverageClass = 'full-edition';
export type EditionStatCoverageClass = 'enriched-cohort';

export interface EditionObservationResults {
  readonly homeWins: number;
  readonly draws: number;
  readonly awayWins: number;
  readonly homeWinPct: number; // 0..100, 1 dp; 0 when matchesCompleted = 0
  readonly drawPct: number;
  readonly awayWinPct: number;
}

export interface EditionObservationGoals {
  readonly total: number;
  readonly home: number;
  readonly away: number;
  readonly perMatch: number; // total / matchesCompleted, 2 dp; 0 when none
}

export interface EditionObservationCleanSheets {
  readonly home: number; // completed fixtures with away_goals = 0
  readonly away: number; // completed fixtures with home_goals = 0
  readonly total: number;
}

/** Cumulative stat totals to this point; null when no fixture so far carried it. */
export interface EditionObservationStatTier {
  readonly expectedGoals: number | null;
  readonly shots: number | null;
  readonly shotsOnTarget: number | null;
  readonly yellowCards: number | null;
  readonly redCards: number | null;
  readonly fouls: number | null;
  readonly kilometersCovered: number | null;
  readonly numberOfSprints: number | null;
}

export interface EditionObservationPoint {
  readonly sequenceIndex: number; // canonical chronological 1..n (never renumbered)
  readonly throughFixtureId: string;
  readonly throughKickoffAt: string; // ISO
  readonly matchesCompleted: number;
  readonly results: EditionObservationResults;
  readonly goals: EditionObservationGoals;
  readonly cleanSheets: EditionObservationCleanSheets;
  readonly statTier: EditionObservationStatTier;
}

export interface EditionResultCoverage {
  readonly class: EditionResultCoverageClass;
  readonly matchesCompleted: number;
  readonly matchesScheduled: number; // all edition fixtures, any lifecycle
}

export interface EditionStatCoverage {
  readonly key: string;
  readonly eligibleFixtures: number;   // completed + result under asOf
  readonly fixturesWithMetric: number; // eligible fixtures with ≥1 usable value
  readonly coveragePct: number;        // 0..100, 1 dp
  readonly class: EditionStatCoverageClass;
}

export interface EditionObservationProvenance {
  readonly statTier: { readonly provider: string | null; readonly retrievedAt: string | null } | null;
}

export interface EditionObservationsResponse {
  readonly edition: { readonly id: string; readonly seasonLabel: string };
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  readonly scope: { readonly asOf: string; readonly order: 'asc' | 'desc' };
  readonly asOf: string;
  readonly observationCount: number; // total eligible completed fixtures ≤ asOf
  readonly series: readonly EditionObservationPoint[]; // emitted (ordered/sliced)
  readonly current: EditionObservationPoint | null;    // final eligible point (never sliced away)
  readonly coverage: {
    readonly resultMetrics: EditionResultCoverage;
    readonly statMetrics: readonly EditionStatCoverage[];
  };
  readonly provenance: EditionObservationProvenance;
}

export interface EditionObservationOptions {
  readonly asOf?: Date;
  readonly order?: 'asc' | 'desc';
  readonly limit?: number | null;
  readonly offset?: number | null;
}

// ── raw row shapes ──────────────────────────────────────────────────────────────

export interface EditionIdentityRow {
  edition_id: string;
  season_label: string;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
  matches_scheduled: number | string;
}

export interface EditionObsFixtureRow {
  fixture_id: string;
  kickoff_at: Date | string;
  home_goals: number | string | null;
  away_goals: number | string | null;
}

export interface EditionObsStatRow {
  fixture_id: string;
  group_name: string;
  statistic_key: string;
  home_value: string | null;
  away_value: string | null;
  value_type: string | null;
  provider_code: string;
  retrieved_at: Date | string;
}

// ── pure helpers ────────────────────────────────────────────────────────────────

export class EditionObservationDataIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = 'EditionObservationDataIntegrityError'; }
}

function iso(v: Date | string): string { return v instanceof Date ? v.toISOString() : new Date(v).toISOString(); }

/** Numeric coercion that preserves a real 0 and never fabricates one. */
export function numericOrNull(v: string | number | null): number | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'number' ? String(v) : v;
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function round1(n: number): number { return Math.round(n * 10) / 10; }
function round2(n: number): number { return Math.round(n * 100) / 100; }

interface CollapsedFixtureStats {
  /** one row's oriented raw values per statistic_key (smallest group_name). */
  readonly byKey: Map<string, { home_value: string | null; away_value: string | null }>;
}

/** Collapse one fixture's ALL-period rows to one entry per statistic_key. Verifies
 *  that BOTH home_value and away_value agree across duplicate group_names (edition
 *  sums use both sides); throws otherwise. Pure. */
export function collapseEditionFixtureStats(rows: readonly EditionObsStatRow[]): CollapsedFixtureStats {
  const groups = new Map<string, EditionObsStatRow[]>();
  for (const r of rows) {
    const g = groups.get(r.statistic_key) ?? [];
    g.push(r); groups.set(r.statistic_key, g);
  }
  const byKey = new Map<string, { home_value: string | null; away_value: string | null }>();
  for (const [key, group] of groups) {
    if (group.length > 1) {
      const homes = new Set(group.map((r) => r.home_value));
      const aways = new Set(group.map((r) => r.away_value));
      if (homes.size > 1 || aways.size > 1) {
        throw new EditionObservationDataIntegrityError(
          `team_match_statistic group disagreement for fixture ${group[0].fixture_id}, statistic_key ${key}: ` +
          `values differ across group_name (home: ${[...homes].join(' | ')}; away: ${[...aways].join(' | ')})`,
        );
      }
    }
    const winner = [...group].sort((a, b) => a.group_name.localeCompare(b.group_name))[0];
    byKey.set(key, { home_value: winner.home_value, away_value: winner.away_value });
  }
  return { byKey };
}

/** One fixture's contribution to a stat metric: sum of present numeric values over
 *  its source keys × both sides. `has` = at least one present contribution. */
export function fixtureStatMetric(
  byKey: ReadonlyMap<string, { home_value: string | null; away_value: string | null }>,
  metric: EditionStatMetricDef,
): { value: number; has: boolean } {
  let sum = 0; let has = false;
  for (const src of metric.sources) {
    const row = byKey.get(src);
    if (!row) continue;
    for (const raw of [row.home_value, row.away_value]) {
      const n = numericOrNull(raw);
      if (n !== null) { sum += n; has = true; }
    }
  }
  return { value: sum, has };
}

interface Accumulator {
  matches: number;
  homeWins: number; draws: number; awayWins: number;
  goalsTotal: number; goalsHome: number; goalsAway: number;
  csHome: number; csAway: number;
  statSum: Map<string, number>;   // metric key → cumulative sum
  statSeen: Set<string>;          // metric keys that have contributed so far
}

function pointFromAccumulator(acc: Accumulator, sequenceIndex: number, fixtureId: string, kickoffAt: string): EditionObservationPoint {
  const mc = acc.matches;
  const pct = (n: number): number => (mc > 0 ? round1((n / mc) * 100) : 0);
  const statTier: Record<string, number | null> = {};
  for (const m of EDITION_STAT_METRICS) {
    statTier[m.key] = acc.statSeen.has(m.key) ? (acc.statSum.get(m.key) ?? 0) : null;
  }
  return {
    sequenceIndex,
    throughFixtureId: fixtureId,
    throughKickoffAt: kickoffAt,
    matchesCompleted: mc,
    results: {
      homeWins: acc.homeWins, draws: acc.draws, awayWins: acc.awayWins,
      homeWinPct: pct(acc.homeWins), drawPct: pct(acc.draws), awayWinPct: pct(acc.awayWins),
    },
    goals: {
      total: acc.goalsTotal, home: acc.goalsHome, away: acc.goalsAway,
      perMatch: mc > 0 ? round2(acc.goalsTotal / mc) : 0,
    },
    cleanSheets: { home: acc.csHome, away: acc.csAway, total: acc.csHome + acc.csAway },
    statTier: statTier as unknown as EditionObservationStatTier,
  };
}

/** Assemble the full response. Pure. `fixtures` MUST be in canonical chronological
 *  order (kickoff ASC, id ASC). Aggregation happens over ALL fixtures; order/limit/
 *  offset only reshape the emitted series (never `current`, never sequenceIndex). */
export function assembleEditionObservations(
  identity: { edition: { id: string; seasonLabel: string }; competition: { id: string; name: string; slug: string }; matchesScheduled: number },
  fixtures: readonly EditionObsFixtureRow[],
  statsByFixture: ReadonlyMap<string, EditionObsStatRow[]>,
  opts: { asOf: Date; order: 'asc' | 'desc'; limit: number | null; offset: number | null },
): EditionObservationsResponse {
  const acc: Accumulator = {
    matches: 0, homeWins: 0, draws: 0, awayWins: 0,
    goalsTotal: 0, goalsHome: 0, goalsAway: 0, csHome: 0, csAway: 0,
    statSum: new Map(), statSeen: new Set(),
  };
  const fullSeries: EditionObservationPoint[] = [];
  const fixturesWithMetric = new Map<string, number>();
  let provider: string | null = null;
  let retrievedAt: string | null = null;
  let anyStatRow = false;

  fixtures.forEach((f, i) => {
    const hg = numericOrNull(f.home_goals);
    const ag = numericOrNull(f.away_goals);
    // Eligibility (INNER JOIN result) guarantees a result; defend a null score as 0.
    const homeGoals = hg ?? 0;
    const awayGoals = ag ?? 0;
    acc.matches += 1;
    if (homeGoals > awayGoals) acc.homeWins += 1;
    else if (homeGoals < awayGoals) acc.awayWins += 1;
    else acc.draws += 1;
    acc.goalsTotal += homeGoals + awayGoals;
    acc.goalsHome += homeGoals;
    acc.goalsAway += awayGoals;
    if (awayGoals === 0) acc.csHome += 1;
    if (homeGoals === 0) acc.csAway += 1;

    const statRows = statsByFixture.get(f.fixture_id) ?? [];
    if (statRows.length > 0) {
      const collapsed = collapseEditionFixtureStats(statRows);
      for (const m of EDITION_STAT_METRICS) {
        const fm = fixtureStatMetric(collapsed.byKey, m);
        if (fm.has) {
          acc.statSum.set(m.key, (acc.statSum.get(m.key) ?? 0) + fm.value);
          acc.statSeen.add(m.key);
          fixturesWithMetric.set(m.key, (fixturesWithMetric.get(m.key) ?? 0) + 1);
        }
      }
      for (const r of statRows) {
        anyStatRow = true;
        provider = r.provider_code;
        const t = iso(r.retrieved_at);
        if (retrievedAt === null || t > retrievedAt) retrievedAt = t;
      }
    }

    fullSeries.push(pointFromAccumulator(acc, i + 1, f.fixture_id, iso(f.kickoff_at)));
  });

  const eligibleFixtures = fullSeries.length;
  const current = eligibleFixtures > 0 ? fullSeries[eligibleFixtures - 1] : null;

  // Emitted series: order → offset → limit, applied AFTER aggregation.
  let emitted = fullSeries;
  if (opts.order === 'desc') emitted = [...fullSeries].reverse();
  if (opts.offset != null && opts.offset > 0) emitted = emitted.slice(opts.offset);
  if (opts.limit != null) emitted = emitted.slice(0, opts.limit);

  const statMetrics: EditionStatCoverage[] = EDITION_STAT_METRICS.map((m) => {
    const withMetric = fixturesWithMetric.get(m.key) ?? 0;
    return {
      key: m.key,
      eligibleFixtures,
      fixturesWithMetric: withMetric,
      coveragePct: eligibleFixtures > 0 ? round1((withMetric / eligibleFixtures) * 100) : 0,
      class: 'enriched-cohort',
    };
  });

  return {
    edition: identity.edition,
    competition: identity.competition,
    scope: { asOf: opts.asOf.toISOString(), order: opts.order },
    asOf: opts.asOf.toISOString(),
    observationCount: eligibleFixtures,
    series: emitted,
    current,
    coverage: {
      resultMetrics: { class: 'full-edition', matchesCompleted: eligibleFixtures, matchesScheduled: identity.matchesScheduled },
      statMetrics,
    },
    provenance: { statTier: anyStatRow ? { provider, retrievedAt } : null },
  };
}

// ── SQL (read-only) ─────────────────────────────────────────────────────────────

// Identity + exposure. matches_scheduled counts ALL edition fixtures (any lifecycle)
// as the season-progress denominator. Null → 404.
const EDITION_IDENTITY_SQL = `
  SELECT ce.id::text          AS edition_id,
         ce.season_label      AS season_label,
         c.id::text           AS competition_id,
         c.name               AS competition_name,
         c.slug               AS competition_slug,
         (SELECT count(*) FROM football.fixture f WHERE f.competition_edition_id = ce.id) AS matches_scheduled
    FROM football.competition_edition ce
    JOIN football.competition c ON c.id = ce.competition_id
   WHERE ce.id = $1::bigint
`;

// Query A: every eligible completed, result-bearing fixture in the edition, strictly
// before asOf, in canonical chronological order. NO LIMIT/OFFSET — the full set is
// required for correct cumulative totals. $1 edition · $2 as_of (STRICT <).
export const EDITION_OBSERVATIONS_FIXTURES_SQL = `
  SELECT f.id::text            AS fixture_id,
         f.scheduled_kickoff_at AS kickoff_at,
         r.home_goals          AS home_goals,
         r.away_goals          AS away_goals
    FROM football.fixture f
    JOIN football.result r
      ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
   WHERE f.competition_edition_id = $1::bigint
     AND f.lifecycle_state_code = 'COMPLETED'
     AND f.scheduled_kickoff_at < $2::timestamptz
   ORDER BY f.scheduled_kickoff_at ASC, f.id ASC
`;

// Query B: ALL-period team stats for the returned fixtures. $1 fixture ids.
export const EDITION_OBSERVATIONS_STATS_SQL = `
  SELECT tms.fixture_id::text AS fixture_id, tms.group_name AS group_name,
         tms.statistic_key AS statistic_key,
         tms.home_value AS home_value, tms.away_value AS away_value,
         tms.value_type AS value_type, tms.provider_code AS provider_code, tms.retrieved_at AS retrieved_at
    FROM football.team_match_statistic tms
   WHERE tms.fixture_id = ANY($1::bigint[]) AND tms.period = 'ALL'
   ORDER BY tms.fixture_id, tms.statistic_key, tms.group_name
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

/** Returns the edition's cumulative descriptive observations, or null when the
 *  edition does not exist (→ 404). A valid edition with no eligible fixtures yields
 *  an empty series. At most three queries: identity + fixtures + one bounded stats
 *  query (no per-fixture N+1). */
export async function readEditionObservations(
  tx: PoolClient,
  editionId: string,
  options: EditionObservationOptions = {},
): Promise<EditionObservationsResponse | null> {
  const identityRes = await tx.query<EditionIdentityRow>(EDITION_IDENTITY_SQL, [editionId]);
  if (identityRes.rows.length === 0) return null;
  const idRow = identityRes.rows[0];
  const identity = {
    edition: { id: idRow.edition_id, seasonLabel: idRow.season_label },
    competition: { id: idRow.competition_id, name: idRow.competition_name, slug: idRow.competition_slug },
    matchesScheduled: Number(idRow.matches_scheduled),
  };

  const asOf = options.asOf ?? new Date();
  const order: 'asc' | 'desc' = options.order === 'desc' ? 'desc' : 'asc';
  const limit = options.limit ?? null;
  const offset = options.offset ?? null;

  const fixturesRes = await tx.query<EditionObsFixtureRow>(EDITION_OBSERVATIONS_FIXTURES_SQL, [editionId, asOf]);
  const fixtures = fixturesRes.rows;

  const statsByFixture = new Map<string, EditionObsStatRow[]>();
  if (fixtures.length > 0) {
    const ids = fixtures.map((f) => f.fixture_id);
    const statsRes = await tx.query<EditionObsStatRow>(EDITION_OBSERVATIONS_STATS_SQL, [ids]);
    for (const row of statsRes.rows) {
      const bucket = statsByFixture.get(row.fixture_id) ?? [];
      bucket.push(row); statsByFixture.set(row.fixture_id, bucket);
    }
  }

  return assembleEditionObservations(identity, fixtures, statsByFixture, { asOf, order, limit, offset });
}
