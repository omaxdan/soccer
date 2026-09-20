// ─────────────────────────────────────────────────────────────────────────────
// TEAM MATCH-PERFORMANCE OBSERVATIONS — read model (descriptive, chronological)
//
// Answers ONLY "what did this team record in each completed match?". It is a
// chronological, target-team-oriented, descriptive projection over the EXISTING
// substrate:
//   football.fixture            — eligibility (COMPLETED), kickoff, edition, sides
//   football.result             — goals (deterministic W/D/L, margin, points, CS)
//   football.team_match_statistic — per-fixture team stats (ALL period), home/away
//     values on one row per (fixture, period, group_name, statistic_key)
//
// It computes NOTHING interpretive: no trend, no per-90, no rolling change, no
// "improving/regressing", no prediction. Every metric is the provider value oriented
// to the target team; xGA is the deterministic opponent-xG relational attribution.
//
// Semantics locked by the frozen contract:
//   • TARGET ORIENTATION — target home → home_value/home_display; target away → away_*.
//     Never expose the opponent's value as the team's. Applies to goals and every metric.
//   • GROUP DEDUP — one metric per (fixture, statistic_key) at ALL period, selecting the
//     lexicographically smallest group_name (a BACKEND-LOCAL deterministic rule; NOT the
//     frontend ordering). Before collapsing, the oriented target values across duplicate
//     groups MUST agree; a disagreement is a data-integrity condition (throws), never a
//     silent pick.
//   • MISSING ≠ ZERO — an absent statistic_key is omitted; a present non-numeric value is
//     null; a literal stored "0" stays 0.
//   • STRICT as_of — eligibility uses `scheduled_kickoff_at < asOf` (never <=), matching
//     feature/read/fixtures.ts. This descriptive cutoff is distinct from module as_of and
//     calculated_at.
//   • PROVENANCE — per observation (provider + latest retrieved_at across that fixture's
//     rows), reusing the matchTeamStatistics provenance convention. No series-wide retrievedAt.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

/** Canonical descriptive team match-statistic keys (registry-confirmed present in
 *  football.team_match_statistic). CANONICAL MEMBERSHIP is independent of current
 *  coverage: a legitimate key stays canonical even at partial coverage. `avgRating`
 *  is a provider composite RATING, not a raw descriptive statistic → definitionally
 *  excluded. `expectedGoals` also drives the dedicated xg/xga fields. */
export const CANONICAL_OBSERVATION_METRIC_KEYS = [
  // core (high-density)
  'ballPossession', 'passes', 'accuratePasses', 'accurateCross', 'accurateLongBalls',
  'cornerKicks', 'goalKicks', 'throwIns', 'freeKicks', 'fouls', 'yellowCards',
  'totalShotsOnGoal', 'shotsOnGoal', 'shotsOffGoal', 'totalShotsInsideBox', 'totalShotsOutsideBox',
  'blockedScoringAttempt', 'totalTackle', 'wonTacklePercent', 'totalClearance', 'interceptionWon',
  'ballRecovery', 'dispossessed', 'finalThirdEntries', 'duelWonPercent',
  'groundDuelsPercentage', 'aerialDuelsPercentage', 'dribblesPercentage', 'goalkeeperSaves',
  // high-coverage optional
  'expectedGoals', 'expectedGoalsOnTarget', 'goalsPrevented', 'touchesInOppBox', 'bigChanceCreated',
  'kilometersCovered', 'numberOfSprints', 'finalThirdPhaseStatistic', 'offsides', 'bigChanceMissed', 'punches',
  'fouledFinalThird',
  // event-conditional (legitimately sparse; absence is not zero)
  'bigChanceScored', 'accurateThroughBall', 'errorsLeadToShot', 'hitWoodwork', 'redCards',
  'errorsLeadToGoal', 'penaltySaves',
] as const;

const XG_KEY = 'expectedGoals';

// ── coverage vocabulary (per-domain, following the backend convention) ──────────
/** Metric completeness across a team's observations. Extends the team CoverageState
 *  with `partial` (some-but-not-all observations carry the metric). */
export type MetricCoverageState = 'present' | 'partial' | 'absent' | 'not-supported';
/** Observation existence for the series. */
export type ObservationCoverageState = 'present' | 'absent';

// ── wire DTOs ───────────────────────────────────────────────────────────────────

export interface ObservationMetric {
  readonly key: string;
  readonly value: number | null; // provider value; null = present-but-non-numeric; never zero-filled
  readonly display: string | null;
}

export interface ObservationProvenance {
  readonly provider: string | null;
  readonly retrievedAt: string | null; // ISO; latest across THIS fixture's rows
}

export interface TeamObservation {
  readonly fixtureId: string;
  readonly fixturePartitionOn: string;
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  readonly edition: { readonly id: string; readonly seasonLabel: string };
  readonly kickoffAt: string; // ISO
  readonly sequenceIndex: number; // 1..n in returned order
  readonly opponent: { readonly id: string; readonly name: string; readonly slug: string };
  readonly venueSide: 'home' | 'away';
  // Deterministic result facts (target-oriented). Not governed.
  readonly result: 'W' | 'D' | 'L';
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalMargin: number;
  readonly points: number;
  readonly cleanSheet: boolean;
  // Deterministic relational attributions.
  readonly xg: number | null;   // target expectedGoals
  readonly xga: number | null;  // opponent expectedGoals on the same fixture
  readonly provenance: ObservationProvenance;
  readonly metrics: readonly ObservationMetric[];
}

export interface TeamObservationMetricCoverage {
  readonly key: string;
  readonly state: MetricCoverageState;
  readonly present: number; // observations with a non-null value
  readonly total: number;   // total observations
}

export interface TeamObservationsResponse {
  readonly team: { readonly id: string; readonly name: string; readonly slug: string };
  readonly scope: {
    readonly competition: 'all' | 'edition';
    readonly editionId: string | null;
    readonly venue: 'all' | 'home' | 'away';
    readonly order: 'asc' | 'desc';
  };
  readonly asOf: string; // ISO cutoff actually applied
  readonly observationCount: number;
  readonly coverage: {
    readonly observations: ObservationCoverageState;
    readonly metrics: readonly TeamObservationMetricCoverage[];
  };
  readonly observations: readonly TeamObservation[];
}

export interface TeamObservationOptions {
  readonly asOf?: Date;
  readonly editionId?: string | null;
  readonly venue?: 'home' | 'away' | null;
  readonly order?: 'asc' | 'desc';
  readonly limit?: number | null;
  readonly offset?: number | null;
}

// ── raw row shapes ──────────────────────────────────────────────────────────────

export interface ObsFixtureRow {
  fixture_id: string;
  fixture_partition_on: string;
  kickoff_at: Date | string;
  is_home: boolean;
  edition_id: string;
  season_label: string;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
  opponent_id: string;
  opponent_name: string;
  opponent_slug: string;
  home_goals: number | string | null;
  away_goals: number | string | null;
}

export interface ObsStatRow {
  fixture_id: string;
  group_name: string;
  statistic_key: string;
  statistic_name: string | null;
  home_value: string | null;
  away_value: string | null;
  home_display: string | null;
  away_display: string | null;
  value_type: string | null;
  provider_code: string;
  retrieved_at: Date | string;
}

// ── pure helpers ────────────────────────────────────────────────────────────────

/** A group-disagreement is a data-integrity condition, surfaced (never silently resolved). */
export class TeamObservationDataIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = 'TeamObservationDataIntegrityError'; }
}

function iso(v: Date | string): string { return v instanceof Date ? v.toISOString() : new Date(v).toISOString(); }

/** Numeric coercion that preserves a real 0 and never fabricates one. */
export function numericOrNull(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** The target team's raw value/display on a stat row (home_* when home, away_* when away). */
export function orientStat(row: ObsStatRow, isHome: boolean): { value: string | null; display: string | null } {
  return isHome ? { value: row.home_value, display: row.home_display } : { value: row.away_value, display: row.away_display };
}

/** Deterministic result facts from target-oriented goals. */
export function deriveResult(goalsFor: number, goalsAgainst: number): {
  result: 'W' | 'D' | 'L'; goalMargin: number; points: number; cleanSheet: boolean;
} {
  const result = goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
  const points = result === 'W' ? 3 : result === 'D' ? 1 : 0;
  return { result, goalMargin: goalsFor - goalsAgainst, points, cleanSheet: goalsAgainst === 0 };
}

interface CollapsedFixture {
  /** winner row per statistic_key (smallest group_name), oriented-agreement verified. */
  readonly byKey: Map<string, ObsStatRow>;
  readonly provider: string | null;
  readonly retrievedAt: string | null;
}

/** Collapse one fixture's ALL-period rows to one row per statistic_key. Verifies that
 *  the target-oriented values agree across duplicate group_names; throws otherwise. */
export function collapseFixtureStats(rows: readonly ObsStatRow[], isHome: boolean): CollapsedFixture {
  const groups = new Map<string, ObsStatRow[]>();
  for (const r of rows) {
    const g = groups.get(r.statistic_key) ?? [];
    g.push(r); groups.set(r.statistic_key, g);
  }
  const byKey = new Map<string, ObsStatRow>();
  for (const [key, group] of groups) {
    if (group.length > 1) {
      const orientedValues = new Set(group.map((r) => orientStat(r, isHome).value));
      if (orientedValues.size > 1) {
        const fixtureId = group[0].fixture_id;
        throw new TeamObservationDataIntegrityError(
          `team_match_statistic group disagreement for fixture ${fixtureId}, statistic_key ${key}: ` +
          `oriented values differ across group_name (${[...orientedValues].map((v) => String(v)).join(' | ')})`,
        );
      }
    }
    // Deterministic backend-local rule: smallest group_name.
    const winner = [...group].sort((a, b) => a.group_name.localeCompare(b.group_name))[0];
    byKey.set(key, winner);
  }
  let provider: string | null = null;
  let retrievedAt: string | null = null;
  for (const r of rows) {
    provider = r.provider_code;
    const t = iso(r.retrieved_at);
    if (retrievedAt === null || t > retrievedAt) retrievedAt = t;
  }
  return { byKey, provider, retrievedAt };
}

/** Build one observation from its fixture row + collapsed stats. `sequenceIndex` is 1-based. */
export function buildObservation(f: ObsFixtureRow, rows: readonly ObsStatRow[], sequenceIndex: number): TeamObservation {
  const isHome = f.is_home;
  const homeGoals = numericOrNull(f.home_goals === null ? null : String(f.home_goals));
  const awayGoals = numericOrNull(f.away_goals === null ? null : String(f.away_goals));
  // Eligibility guarantees a result row; treat a null score defensively as 0-0 avoided by SQL.
  const goalsFor = (isHome ? homeGoals : awayGoals) ?? 0;
  const goalsAgainst = (isHome ? awayGoals : homeGoals) ?? 0;
  const derived = deriveResult(goalsFor, goalsAgainst);

  const collapsed = collapseFixtureStats(rows, isHome);

  // xG / xGA — deterministic relational attribution from the SAME expectedGoals row.
  const xgRow = collapsed.byKey.get(XG_KEY) ?? null;
  const xg = xgRow ? numericOrNull(orientStat(xgRow, isHome).value) : null;
  const xga = xgRow ? numericOrNull(orientStat(xgRow, !isHome).value) : null;

  // Metrics — canonical order; emit a metric only when the key's row exists for this
  // fixture (absence is honest, never zero). Non-numeric present value → null.
  const metrics: ObservationMetric[] = [];
  for (const key of CANONICAL_OBSERVATION_METRIC_KEYS) {
    const row = collapsed.byKey.get(key);
    if (!row) continue; // absent → omitted (coverage reports partial/absent)
    const oriented = orientStat(row, isHome);
    metrics.push({ key, value: numericOrNull(oriented.value), display: oriented.display });
  }

  return {
    fixtureId: f.fixture_id,
    fixturePartitionOn: f.fixture_partition_on,
    competition: { id: f.competition_id, name: f.competition_name, slug: f.competition_slug },
    edition: { id: f.edition_id, seasonLabel: f.season_label },
    kickoffAt: iso(f.kickoff_at),
    sequenceIndex,
    opponent: { id: f.opponent_id, name: f.opponent_name, slug: f.opponent_slug },
    venueSide: isHome ? 'home' : 'away',
    result: derived.result,
    goalsFor,
    goalsAgainst,
    goalMargin: derived.goalMargin,
    points: derived.points,
    cleanSheet: derived.cleanSheet,
    xg,
    xga,
    provenance: { provider: collapsed.provider, retrievedAt: collapsed.retrievedAt },
    metrics,
  };
}

/** Per-metric coverage across the observation set (present/partial/absent). */
export function computeMetricCoverage(observations: readonly TeamObservation[]): TeamObservationMetricCoverage[] {
  const total = observations.length;
  return CANONICAL_OBSERVATION_METRIC_KEYS.map((key) => {
    const present = observations.reduce((n, o) => {
      const m = o.metrics.find((x) => x.key === key);
      return n + (m && m.value !== null ? 1 : 0);
    }, 0);
    const state: MetricCoverageState = total === 0 ? 'absent' : present === 0 ? 'absent' : present === total ? 'present' : 'partial';
    return { key, state, present, total };
  });
}

/** Assemble the response from ordered fixture rows + their stat rows. Pure. */
export function assembleTeamObservations(
  team: { id: string; name: string; slug: string },
  fixtures: readonly ObsFixtureRow[],
  statsByFixture: ReadonlyMap<string, ObsStatRow[]>,
  opts: { asOf: Date; editionId: string | null; venue: 'home' | 'away' | null; order: 'asc' | 'desc' },
): TeamObservationsResponse {
  const observations = fixtures.map((f, i) => buildObservation(f, statsByFixture.get(f.fixture_id) ?? [], i + 1));
  return {
    team,
    scope: {
      competition: opts.editionId ? 'edition' : 'all',
      editionId: opts.editionId,
      venue: opts.venue ?? 'all',
      order: opts.order,
    },
    asOf: opts.asOf.toISOString(),
    observationCount: observations.length,
    coverage: {
      observations: observations.length > 0 ? 'present' : 'absent',
      metrics: computeMetricCoverage(observations),
    },
    observations,
  };
}

// ── SQL (read-only) ─────────────────────────────────────────────────────────────
//
// Query 1: eligible completed, result-bearing fixtures for the team (oriented context).
//   $1 team id · $2 as_of (STRICT <) · $3 edition|null · $4 venue|null · $5 limit|null · $6 offset|null
// The ORDER direction is a whitelisted literal (asc|desc), never user text.

export function teamObservationsFixturesSql(order: 'asc' | 'desc'): string {
  const dir = order === 'desc' ? 'DESC' : 'ASC';
  return `
    SELECT f.id::text                       AS fixture_id,
           f.fixture_partition_on::text     AS fixture_partition_on,
           f.scheduled_kickoff_at           AS kickoff_at,
           (f.home_team_id = $1::bigint)    AS is_home,
           ce.id::text                      AS edition_id,
           ce.season_label                  AS season_label,
           c.id::text                       AS competition_id,
           c.name                           AS competition_name,
           c.slug                           AS competition_slug,
           o.id::text                       AS opponent_id,
           o.name                           AS opponent_name,
           o.slug                           AS opponent_slug,
           r.home_goals                     AS home_goals,
           r.away_goals                     AS away_goals
      FROM football.fixture f
      JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
      JOIN football.competition c          ON c.id = ce.competition_id
      JOIN football.result r               ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
      JOIN football.team o                 ON o.id = CASE WHEN f.home_team_id = $1::bigint THEN f.away_team_id ELSE f.home_team_id END
     WHERE (f.home_team_id = $1::bigint OR f.away_team_id = $1::bigint)
       AND f.lifecycle_state_code = 'COMPLETED'
       AND f.scheduled_kickoff_at < $2::timestamptz
       AND ($3::bigint IS NULL OR f.competition_edition_id = $3::bigint)
       AND ($4::text IS NULL
            OR ($4 = 'home' AND f.home_team_id = $1::bigint)
            OR ($4 = 'away' AND f.away_team_id = $1::bigint))
     ORDER BY f.scheduled_kickoff_at ${dir}, f.id ${dir}
     LIMIT $5 OFFSET COALESCE($6::bigint, 0)
  `;
}

/** Query 2: ALL-period team stats for the returned fixtures. $1 fixture ids. */
export const TEAM_OBSERVATIONS_STATS_SQL = `
  SELECT tms.fixture_id::text AS fixture_id, tms.group_name AS group_name,
         tms.statistic_key AS statistic_key, tms.statistic_name AS statistic_name,
         tms.home_value AS home_value, tms.away_value AS away_value,
         tms.home_display AS home_display, tms.away_display AS away_display,
         tms.value_type AS value_type, tms.provider_code AS provider_code, tms.retrieved_at AS retrieved_at
    FROM football.team_match_statistic tms
   WHERE tms.fixture_id = ANY($1::bigint[]) AND tms.period = 'ALL'
   ORDER BY tms.fixture_id, tms.statistic_key, tms.group_name
`;

const TEAM_IDENTITY_SQL = `SELECT id::text AS id, name AS name, slug AS slug FROM football.team WHERE id = $1::bigint`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

/** Returns the team's descriptive match observations, or null when the team does
 *  not exist (→ 404). A valid team with no eligible fixtures yields an empty series. */
export async function readTeamObservations(
  tx: PoolClient,
  teamId: string,
  options: TeamObservationOptions = {},
): Promise<TeamObservationsResponse | null> {
  const identity = await tx.query<{ id: string; name: string; slug: string }>(TEAM_IDENTITY_SQL, [teamId]);
  if (identity.rows.length === 0) return null;
  const team = identity.rows[0];

  const asOf = options.asOf ?? new Date();
  const editionId = options.editionId ?? null;
  const venue = options.venue ?? null;
  const order: 'asc' | 'desc' = options.order === 'desc' ? 'desc' : 'asc';
  const limit = options.limit ?? null;
  const offset = options.offset ?? null;

  const fixturesRes = await tx.query<ObsFixtureRow>(teamObservationsFixturesSql(order), [
    teamId, asOf, editionId, venue, limit, offset,
  ]);
  const fixtures = fixturesRes.rows;

  const statsByFixture = new Map<string, ObsStatRow[]>();
  if (fixtures.length > 0) {
    const ids = fixtures.map((f) => f.fixture_id);
    const statsRes = await tx.query<ObsStatRow>(TEAM_OBSERVATIONS_STATS_SQL, [ids]);
    for (const row of statsRes.rows) {
      const bucket = statsByFixture.get(row.fixture_id) ?? [];
      bucket.push(row); statsByFixture.set(row.fixture_id, bucket);
    }
  }

  return assembleTeamObservations(team, fixtures, statsByFixture, { asOf, editionId, venue, order });
}
