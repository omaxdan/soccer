// ─────────────────────────────────────────────────────────────────────────────
// PLAYER MATCH-PERFORMANCE OBSERVATIONS — read model (descriptive, chronological)
//
// Answers ONLY "what did this player record in each completed match?". A
// chronological, player-team-scoped, descriptive projection over the EXISTING
// substrate:
//   football.fixture              — eligibility (COMPLETED), kickoff, edition, sides
//   football.result               — goals (deterministic W/D/L, margin, points, CS)
//   football.player_match_statistic — per-player per-fixture EAV stats; team_id is
//     authoritative for that fixture; unique per (fixture, player, statistic_key)
//   football.lineup / lineup_selection — participation (STARTED / BENCH), when present
//
// It computes NOTHING interpretive: no trend, no per-90, no rolling change, no
// rating, no "improving/regressing", no prediction. Every metric is the raw provider
// value for that player-fixture.
//
// STRUCTURAL DIFFERENCES FROM Team Observation (deliberately NOT copied):
//   • NO home_value/away_value orientation — a player row carries a single value and
//     its own team_id; venue side is derived from the fixture, not from the value.
//   • NO group_name deduplication and NO data-integrity error — the natural key
//     (fixture_partition_on, fixture_id, player_id, statistic_key) already guarantees
//     one row per key.
//   • NO period='ALL' filter — player_match_statistic has no period column.
//   • NO xGA — player xG is the player's own expectedGoals only; there is no
//     player-level opponent-xG attribution. xGA is never derived here.
//
// Semantics locked by the approved specification:
//   • ANCHOR — a fixture enters the series iff the player has ≥1 player_match_statistic
//     row for it (and it is COMPLETED, result-bearing, kickoff < asOf). A missing stat
//     row is NEVER read as absence.
//   • TEAM SCOPE — player_match_statistic.team_id is the player's team FOR THAT FIXTURE
//     (historical), never the current team.
//   • PARTICIPATION — STARTED (is_starting=true) / BENCH (is_starting=false) / UNKNOWN
//     (no lineup row). Never BENCH_USED/BENCH_UNUSED; player_availability is not consulted.
//   • MISSING ≠ ZERO — absent key omitted; present non-numeric/json → null; stored "0" → 0.
//   • STRICT as_of — eligibility uses `scheduled_kickoff_at < asOf` (never <=).
//   • PROVENANCE — per observation (provider + latest retrieved_at across that player's
//     rows for the fixture).
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

/** Canonical descriptive player match-statistic keys (live-P1 confirmed present in
 *  football.player_match_statistic). CANONICAL MEMBERSHIP is independent of current
 *  coverage. Composite/normalized/metadata keys (`rating`, `ratingVersions`,
 *  `statisticsType`, `defensiveValueNormalized`, `passValueNormalized`,
 *  `dribbleValueNormalized`) are EXCLUDED. `keyPasses` and `goalsPrevented` were NOT
 *  returned by live P1 and are therefore excluded from v1. `expectedGoals` also drives
 *  the dedicated `xg` field (there is no player xGA). */
export const CANONICAL_PLAYER_OBSERVATION_METRIC_KEYS = [
  // participation / minutes
  'minutesPlayed',
  // attacking output
  'goals', 'goalAssist',
  // chance creation
  'expectedAssists', 'bigChanceCreated',
  // shooting
  'totalShots', 'expectedGoals', 'expectedGoalsOnTarget', 'bigChanceMissed', 'savedShotsFromInsideTheBox',
  // passing
  'totalPass', 'accuratePass', 'totalOppositionHalfPasses', 'accurateOppositionHalfPasses',
  'totalOwnHalfPasses', 'accurateOwnHalfPasses',
  // ball progression / carries
  'touches', 'totalBallCarriesDistance', 'ballCarriesCount', 'totalProgression',
  'progressiveBallCarriesCount', 'possessionLostCtrl',
  // duels / defensive
  'duelWon', 'duelLost', 'ballRecovery', 'totalTackle', 'interceptionWon', 'totalClearance',
  'totalContest', 'wonContest',
  // goalkeeping
  'saves', 'goodHighClaim',
  // physical
  'kilometersCovered', 'numberOfSprints', 'topSpeed',
  'metersCoveredHighSpeedRunningKm', 'metersCoveredRunningKm', 'metersCoveredSprintingKm',
] as const;

const XG_KEY = 'expectedGoals';

// ── coverage vocabulary (per-domain, following the backend convention) ──────────
export type PlayerMetricCoverageState = 'present' | 'partial' | 'absent' | 'not-supported';
export type PlayerObservationCoverageState = 'present' | 'absent';

// ── wire DTOs ───────────────────────────────────────────────────────────────────

export interface PlayerObservationMetric {
  readonly key: string;
  readonly value: number | null; // provider value; null = present-but-non-numeric; never zero-filled
  readonly display: string | null; // player_match_statistic carries no display column → always null
}

export interface PlayerObservationProvenance {
  readonly provider: string | null;
  readonly retrievedAt: string | null; // ISO; latest across THIS player's rows for the fixture
}

export type PlayerParticipation = 'STARTED' | 'BENCH' | 'UNKNOWN';

export interface PlayerObservation {
  readonly fixtureId: string;
  readonly fixturePartitionOn: string;
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  readonly edition: { readonly id: string; readonly seasonLabel: string };
  readonly kickoffAt: string; // ISO
  readonly sequenceIndex: number; // 1..n in returned order
  readonly team: { readonly id: string; readonly name: string; readonly slug: string }; // player's team FOR THIS FIXTURE
  readonly opponent: { readonly id: string; readonly name: string; readonly slug: string };
  readonly venueSide: 'home' | 'away';
  readonly participation: PlayerParticipation;
  // Deterministic result facts (player-team-oriented). Not governed.
  readonly result: 'W' | 'D' | 'L';
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalMargin: number;
  readonly points: number;
  readonly cleanSheet: boolean;
  readonly xg: number | null; // player expectedGoals (own only; never opponent-derived)
  readonly provenance: PlayerObservationProvenance;
  readonly metrics: readonly PlayerObservationMetric[];
}

export interface PlayerObservationMetricCoverage {
  readonly key: string;
  readonly state: PlayerMetricCoverageState;
  readonly present: number; // observations with a non-null value
  readonly total: number;   // total observations
}

export interface PlayerObservationsResponse {
  readonly player: { readonly id: string; readonly fullName: string; readonly slug: string };
  readonly scope: {
    readonly competition: 'all' | 'edition';
    readonly editionId: string | null;
    readonly venue: 'all' | 'home' | 'away';
    readonly order: 'asc' | 'desc';
  };
  readonly asOf: string; // ISO cutoff actually applied
  readonly observationCount: number;
  readonly coverage: {
    readonly observations: PlayerObservationCoverageState;
    readonly metrics: readonly PlayerObservationMetricCoverage[];
  };
  readonly observations: readonly PlayerObservation[];
}

export interface PlayerObservationOptions {
  readonly asOf?: Date;
  readonly editionId?: string | null;
  readonly venue?: 'home' | 'away' | null;
  readonly order?: 'asc' | 'desc';
  readonly limit?: number | null;
  readonly offset?: number | null;
}

// ── raw row shapes ──────────────────────────────────────────────────────────────

export interface PlayerObsFixtureRow {
  fixture_id: string;
  fixture_partition_on: string;
  kickoff_at: Date | string;
  is_home: boolean;
  edition_id: string;
  season_label: string;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
  team_id: string;
  team_name: string;
  team_slug: string;
  opponent_id: string;
  opponent_name: string;
  opponent_slug: string;
  home_goals: number | string | null;
  away_goals: number | string | null;
  is_starting: boolean | null;
}

export interface PlayerObsStatRow {
  fixture_id: string;
  statistic_key: string;
  statistic_value: string | null;
  value_type: string | null;
  provider_code: string;
  retrieved_at: Date | string;
}

// ── pure helpers ────────────────────────────────────────────────────────────────

function iso(v: Date | string): string { return v instanceof Date ? v.toISOString() : new Date(v).toISOString(); }

/** Numeric coercion that preserves a real 0 and never fabricates one. */
export function numericOrNull(v: string | null): number | null {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Deterministic result facts from player-team-oriented goals. */
export function deriveResult(goalsFor: number, goalsAgainst: number): {
  result: 'W' | 'D' | 'L'; goalMargin: number; points: number; cleanSheet: boolean;
} {
  const result = goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
  const points = result === 'W' ? 3 : result === 'D' ? 1 : 0;
  return { result, goalMargin: goalsFor - goalsAgainst, points, cleanSheet: goalsAgainst === 0 };
}

/** Participation from the lineup selection, or UNKNOWN when no lineup row exists.
 *  Never BENCH_USED/BENCH_UNUSED (substrate absent); never inferred from stats. */
export function deriveParticipation(isStarting: boolean | null): PlayerParticipation {
  if (isStarting === true) return 'STARTED';
  if (isStarting === false) return 'BENCH';
  return 'UNKNOWN';
}

/** Build one observation from its fixture row + that fixture's player stat rows.
 *  `sequenceIndex` is 1-based in returned order. Pure. */
export function buildObservation(f: PlayerObsFixtureRow, rows: readonly PlayerObsStatRow[], sequenceIndex: number): PlayerObservation {
  const isHome = f.is_home;
  const homeGoals = numericOrNull(f.home_goals === null ? null : String(f.home_goals));
  const awayGoals = numericOrNull(f.away_goals === null ? null : String(f.away_goals));
  // Eligibility (INNER JOIN result) guarantees a result row; a null score is defended as 0.
  const goalsFor = (isHome ? homeGoals : awayGoals) ?? 0;
  const goalsAgainst = (isHome ? awayGoals : homeGoals) ?? 0;
  const derived = deriveResult(goalsFor, goalsAgainst);

  // Index rows by key (the natural key already guarantees one row per key) and
  // compute per-observation provenance (latest retrieved_at across the player's rows).
  const byKey = new Map<string, PlayerObsStatRow>();
  let provider: string | null = null;
  let retrievedAt: string | null = null;
  for (const r of rows) {
    byKey.set(r.statistic_key, r);
    provider = r.provider_code;
    const t = iso(r.retrieved_at);
    if (retrievedAt === null || t > retrievedAt) retrievedAt = t;
  }

  // Player xG — the player's own expectedGoals only. No opponent/team derivation.
  const xgRow = byKey.get(XG_KEY);
  const xg = xgRow && xgRow.value_type !== 'json' ? numericOrNull(xgRow.statistic_value) : null;

  // Metrics — canonical order; emit a metric only when the key's row exists (absence is
  // honest, never zero). json-typed values are excluded; non-numeric present → null.
  const metrics: PlayerObservationMetric[] = [];
  for (const key of CANONICAL_PLAYER_OBSERVATION_METRIC_KEYS) {
    const row = byKey.get(key);
    if (!row) continue; // absent → omitted (coverage reports partial/absent)
    if (row.value_type === 'json') continue; // json excluded from numeric canonical metrics
    metrics.push({ key, value: numericOrNull(row.statistic_value), display: null });
  }

  return {
    fixtureId: f.fixture_id,
    fixturePartitionOn: f.fixture_partition_on,
    competition: { id: f.competition_id, name: f.competition_name, slug: f.competition_slug },
    edition: { id: f.edition_id, seasonLabel: f.season_label },
    kickoffAt: iso(f.kickoff_at),
    sequenceIndex,
    team: { id: f.team_id, name: f.team_name, slug: f.team_slug },
    opponent: { id: f.opponent_id, name: f.opponent_name, slug: f.opponent_slug },
    venueSide: isHome ? 'home' : 'away',
    participation: deriveParticipation(f.is_starting),
    result: derived.result,
    goalsFor,
    goalsAgainst,
    goalMargin: derived.goalMargin,
    points: derived.points,
    cleanSheet: derived.cleanSheet,
    xg,
    provenance: { provider, retrievedAt },
    metrics,
  };
}

/** Per-metric coverage across the observation set (present/partial/absent). */
export function computeMetricCoverage(observations: readonly PlayerObservation[]): PlayerObservationMetricCoverage[] {
  const total = observations.length;
  return CANONICAL_PLAYER_OBSERVATION_METRIC_KEYS.map((key) => {
    const present = observations.reduce((n, o) => {
      const m = o.metrics.find((x) => x.key === key);
      return n + (m && m.value !== null ? 1 : 0);
    }, 0);
    const state: PlayerMetricCoverageState = total === 0 ? 'absent' : present === 0 ? 'absent' : present === total ? 'present' : 'partial';
    return { key, state, present, total };
  });
}

/** Assemble the response from ordered fixture rows + their player stat rows. Pure. */
export function assemblePlayerObservations(
  player: { id: string; fullName: string; slug: string },
  fixtures: readonly PlayerObsFixtureRow[],
  statsByFixture: ReadonlyMap<string, PlayerObsStatRow[]>,
  opts: { asOf: Date; editionId: string | null; venue: 'home' | 'away' | null; order: 'asc' | 'desc' },
): PlayerObservationsResponse {
  const observations = fixtures.map((f, i) => buildObservation(f, statsByFixture.get(f.fixture_id) ?? [], i + 1));
  return {
    player,
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
// Identity/exposure: surfaces the player ONLY when currently registered (not loaned
// out) in a governed, tracked edition — the SAME exposure gate getPlayerDetail uses,
// so an unknown OR unexposed player yields null (→ 404).

const PLAYER_OBS_IDENTITY_SQL = `
  SELECT p.id::text AS id, p.full_name AS full_name, p.slug AS slug
    FROM football.player p
   WHERE p.id = $1::bigint
     AND EXISTS (
       SELECT 1
         FROM football.player_registration pr
         JOIN football.team_registration tr ON tr.team_id = pr.team_id AND tr.withdrawn_on IS NULL
         JOIN football.competition_edition ce ON ce.id = tr.competition_edition_id
         JOIN governance.tracked_edition te
           ON te.competition_edition_id = ce.id
          AND te.edition_status_code = 'ACTIVE'
          AND te.authorized_for_ingestion = true
         JOIN governance.tracked_competition tc
           ON tc.id = te.tracked_competition_id
          AND tc.tracking_status_code = 'TRACKED'
        WHERE pr.player_id = p.id
          AND pr.registration_kind_code <> 'LOAN_OUT'
          AND pr.registration_period @> current_date
     )
`;

// Query A: eligible completed, result-bearing fixtures for the player, with the
// player's team FOR THAT FIXTURE (from player_match_statistic.team_id), opponent, and
// participation (LEFT JOIN lineup/lineup_selection). One row per fixture.
//   $1 player id · $2 as_of (STRICT <) · $3 edition|null · $4 venue|null · $5 limit|null · $6 offset|null
// The ORDER direction is a whitelisted literal (asc|desc), never user text.
export function playerObservationsFixturesSql(order: 'asc' | 'desc'): string {
  const dir = order === 'desc' ? 'DESC' : 'ASC';
  return `
    SELECT f.id::text                    AS fixture_id,
           f.fixture_partition_on::text  AS fixture_partition_on,
           f.scheduled_kickoff_at        AS kickoff_at,
           (f.home_team_id = pt.team_id) AS is_home,
           ce.id::text                   AS edition_id,
           ce.season_label               AS season_label,
           c.id::text                    AS competition_id,
           c.name                        AS competition_name,
           c.slug                        AS competition_slug,
           tm.id::text                   AS team_id,
           tm.name                       AS team_name,
           tm.slug                       AS team_slug,
           o.id::text                    AS opponent_id,
           o.name                        AS opponent_name,
           o.slug                        AS opponent_slug,
           r.home_goals                  AS home_goals,
           r.away_goals                  AS away_goals,
           ls.is_starting                AS is_starting
      FROM (SELECT DISTINCT fixture_id, fixture_partition_on, team_id
              FROM football.player_match_statistic
             WHERE player_id = $1::bigint) pt
      JOIN football.fixture f              ON f.id = pt.fixture_id AND f.fixture_partition_on = pt.fixture_partition_on
      JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
      JOIN football.competition c          ON c.id = ce.competition_id
      JOIN football.result r               ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
      JOIN football.team tm                ON tm.id = pt.team_id
      JOIN football.team o                 ON o.id = CASE WHEN f.home_team_id = pt.team_id THEN f.away_team_id ELSE f.home_team_id END
      LEFT JOIN football.lineup l          ON l.fixture_id = f.id AND l.fixture_partition_on = f.fixture_partition_on AND l.team_id = pt.team_id
      LEFT JOIN football.lineup_selection ls ON ls.lineup_id = l.id AND ls.fixture_partition_on = l.fixture_partition_on AND ls.player_id = $1::bigint
     WHERE f.lifecycle_state_code = 'COMPLETED'
       AND f.scheduled_kickoff_at < $2::timestamptz
       AND ($3::bigint IS NULL OR f.competition_edition_id = $3::bigint)
       AND ($4::text IS NULL
            OR ($4 = 'home' AND f.home_team_id = pt.team_id)
            OR ($4 = 'away' AND f.away_team_id = pt.team_id))
     ORDER BY f.scheduled_kickoff_at ${dir}, f.id ${dir}
     LIMIT $5 OFFSET COALESCE($6::bigint, 0)
  `;
}

/** Query B: all player stat rows for the returned fixtures, scoped to the player.
 *  $1 player id · $2 fixture ids. */
export const PLAYER_OBSERVATIONS_STATS_SQL = `
  SELECT pms.fixture_id::text AS fixture_id, pms.statistic_key AS statistic_key,
         pms.statistic_value AS statistic_value, pms.value_type AS value_type,
         pms.provider_code AS provider_code, pms.retrieved_at AS retrieved_at
    FROM football.player_match_statistic pms
   WHERE pms.player_id = $1::bigint AND pms.fixture_id = ANY($2::bigint[])
   ORDER BY pms.fixture_id, pms.statistic_key
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

/** Returns the player's descriptive match observations, or null when the player does
 *  not exist or is not exposed (→ 404). A valid, exposed player with no eligible
 *  fixtures yields an empty series. At most three queries: identity + fixtures + one
 *  bounded stats query (no per-fixture N+1). */
export async function readPlayerObservations(
  tx: PoolClient,
  playerId: string,
  options: PlayerObservationOptions = {},
): Promise<PlayerObservationsResponse | null> {
  const identity = await tx.query<{ id: string; full_name: string; slug: string }>(PLAYER_OBS_IDENTITY_SQL, [playerId]);
  if (identity.rows.length === 0) return null;
  const player = { id: identity.rows[0].id, fullName: identity.rows[0].full_name, slug: identity.rows[0].slug };

  const asOf = options.asOf ?? new Date();
  const editionId = options.editionId ?? null;
  const venue = options.venue ?? null;
  const order: 'asc' | 'desc' = options.order === 'desc' ? 'desc' : 'asc';
  const limit = options.limit ?? null;
  const offset = options.offset ?? null;

  const fixturesRes = await tx.query<PlayerObsFixtureRow>(playerObservationsFixturesSql(order), [
    playerId, asOf, editionId, venue, limit, offset,
  ]);
  const fixtures = fixturesRes.rows;

  const statsByFixture = new Map<string, PlayerObsStatRow[]>();
  if (fixtures.length > 0) {
    const ids = fixtures.map((f) => f.fixture_id);
    const statsRes = await tx.query<PlayerObsStatRow>(PLAYER_OBSERVATIONS_STATS_SQL, [playerId, ids]);
    for (const row of statsRes.rows) {
      const bucket = statsByFixture.get(row.fixture_id) ?? [];
      bucket.push(row); statsByFixture.set(row.fixture_id, bucket);
    }
  }

  return assemblePlayerObservations(player, fixtures, statsByFixture, { asOf, editionId, venue, order });
}
