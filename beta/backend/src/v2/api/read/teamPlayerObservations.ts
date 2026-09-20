// ─────────────────────────────────────────────────────────────────────────────
// TEAM PLAYER OBSERVATION INDEX — read model (team-scoped, lightweight)
//
// Answers ONLY "which players have observed match evidence FOR THIS TEAM, and a
// headline summary of it?" — a lightweight INDEX for the Team page, NOT the full
// per-player observation history. Each player's complete series remains at the frozen
// GET /api/v2/players/:playerId/observations (the drill-down), never duplicated here.
//
// OBSERVED PLAYERS, not current squad: a player appears iff they have ≥1 eligible
// Player Observation whose underlying player_match_statistic row belongs to THIS TEAM
// (historical fixture-team ownership: football.player_match_statistic.team_id), under
// the requested scope + asOf. Current-squad membership is a separate Team Detail
// concept and is deliberately NOT consulted here.
//
// SEMANTIC PARITY WITH PLAYER OBSERVATION (reused verbatim, not reimplemented):
//   • grain PLAYER × FIXTURE; anchor = ≥1 player_match_statistic row for the fixture
//   • strict `scheduled_kickoff_at < asOf`; COMPLETED + result-bearing eligibility
//   • historical team ownership via player_match_statistic.team_id (the ANCHOR here)
//   • canonical 38-key metric vocabulary (frozen; not expanded)
//   • missing ≠ zero (absent key omitted, non-numeric → null, "0" → 0)
//   • participation STARTED / BENCH / UNKNOWN (never BENCH_USED / ABSENT / NOT_SELECTED)
//   • player xG own-only (no xGA); per-observation provenance
//   • chronology kickoff ASC, fixtureId ASC — the LATEST observation is the last one
//
// The per-fixture observations are built by the SAME pure builder the player endpoint
// uses (buildObservation); this reader only groups them by player and derives a
// bounded headline summary. Two bounded queries, no per-player / per-fixture N+1.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import {
  buildObservation,
  type PlayerObsFixtureRow, type PlayerObsStatRow,
  type PlayerObservation, type PlayerParticipation,
} from './playerObservations';

/** Headline summary metrics for the Team-page list — a MINIMAL, additive (SUM) subset
 *  of the frozen canonical vocabulary. Full metrics remain on the player endpoint.
 *  All four are SUM-class (no MEAN metric here), so summing present values is correct. */
export const TEAM_PLAYER_SUMMARY_METRIC_KEYS = [
  'minutesPlayed', 'goals', 'expectedGoals', 'totalShots',
] as const;

export const TEAM_PLAYER_OBSERVATION_INDEX_VERSION = 'team-player-observation-index-1';

// ── wire DTOs ───────────────────────────────────────────────────────────────────

/** One headline metric, additively summed across a player's eligible observations.
 *  `total` is null when the key is absent from every observation (missing ≠ zero);
 *  `present` / `totalObservations` expose the coverage behind the total. */
export interface TeamPlayerSummaryMetric {
  readonly key: string;
  readonly total: number | null;
  readonly present: number;          // observations carrying a numeric value for this key
  readonly totalObservations: number; // the player's eligible observation count
}

export interface TeamPlayerParticipationCounts {
  readonly started: number;
  readonly bench: number;
  readonly unknown: number;
}

/** Compact projection of the player's chronologically-latest eligible observation. The
 *  full observation (all metrics) is available via the player observation endpoint. */
export interface TeamPlayerLatestObservation {
  readonly fixtureId: string;
  readonly fixturePartitionOn: string;
  readonly kickoffAt: string;
  readonly edition: { readonly id: string; readonly seasonLabel: string };
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
  readonly opponent: { readonly id: string; readonly name: string; readonly slug: string };
  readonly venueSide: 'home' | 'away';
  readonly participation: PlayerParticipation;
  readonly result: 'W' | 'D' | 'L';
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly goalMargin: number;
  readonly points: number;
  readonly cleanSheet: boolean;
  readonly xg: number | null;
}

export interface TeamPlayerObservationEntry {
  readonly player: { readonly id: string; readonly fullName: string; readonly slug: string };
  readonly observationCount: number;
  readonly latestObservation: TeamPlayerLatestObservation;
  readonly participation: TeamPlayerParticipationCounts;
  readonly summary: readonly TeamPlayerSummaryMetric[];
}

export interface TeamPlayerObservationsResponse {
  readonly team: { readonly id: string; readonly name: string; readonly slug: string };
  readonly scope: {
    readonly competition: 'all' | 'edition';
    readonly editionId: string | null;
    readonly label: string; // scope-honest: 'all competitions' or 'edition <id>' — never "league season"
  };
  readonly asOf: string;
  readonly playerCount: number;
  readonly players: readonly TeamPlayerObservationEntry[];
  readonly provenance: {
    readonly source: 'player_match_statistic';
    readonly readModel: string;
    readonly asOf: string;
    readonly teamId: string;
    readonly scope: 'all' | 'edition';
    readonly editionId: string | null;
  };
}

export interface TeamPlayerObservationsOptions {
  readonly asOf?: Date;
  readonly editionId?: string | null;
}

// ── raw row shapes ──────────────────────────────────────────────────────────────

/** Q1 row: a PlayerObsFixtureRow (consumed verbatim by buildObservation) plus the
 *  owning player's id/identity so entries can be grouped by player in-app. */
export interface TeamPlayerObsFixtureRow extends PlayerObsFixtureRow {
  player_id: string;
  player_full_name: string;
  player_slug: string;
}

/** Q2 row: a PlayerObsStatRow plus player_id so stats can be bucketed per (player, fixture). */
export interface TeamPlayerObsStatRow extends PlayerObsStatRow {
  player_id: string;
}

// ── pure helpers ────────────────────────────────────────────────────────────────

const compositeKey = (playerId: string, fixtureId: string): string => `${playerId}|${fixtureId}`;

/** Sum a headline metric across a player's observations. Missing ≠ zero: total is null
 *  when no observation carries a numeric value; a real 0 is preserved. */
export function summarizeMetric(observations: readonly PlayerObservation[], key: string): TeamPlayerSummaryMetric {
  let sum = 0;
  let present = 0;
  for (const o of observations) {
    const m = o.metrics.find((x) => x.key === key);
    if (m && m.value !== null) { sum += m.value; present += 1; }
  }
  return { key, total: present === 0 ? null : sum, present, totalObservations: observations.length };
}

/** Count observed participation states. Descriptive only — never infers ABSENT/NOT_SELECTED. */
export function countParticipation(observations: readonly PlayerObservation[]): TeamPlayerParticipationCounts {
  let started = 0, bench = 0, unknown = 0;
  for (const o of observations) {
    if (o.participation === 'STARTED') started += 1;
    else if (o.participation === 'BENCH') bench += 1;
    else unknown += 1;
  }
  return { started, bench, unknown };
}

function toLatest(o: PlayerObservation): TeamPlayerLatestObservation {
  return {
    fixtureId: o.fixtureId,
    fixturePartitionOn: o.fixturePartitionOn,
    kickoffAt: o.kickoffAt,
    edition: o.edition,
    competition: o.competition,
    opponent: o.opponent,
    venueSide: o.venueSide,
    participation: o.participation,
    result: o.result,
    goalsFor: o.goalsFor,
    goalsAgainst: o.goalsAgainst,
    goalMargin: o.goalMargin,
    points: o.points,
    cleanSheet: o.cleanSheet,
    xg: o.xg,
  };
}

/** Build one player's index entry from their eligible fixture rows (chronological ASC)
 *  and the stats bucketed per (player, fixture). Reuses buildObservation for full parity.
 *  `latestObservation` is the last (chronologically newest) eligible observation. */
export function buildTeamPlayerEntry(
  fixtureRows: readonly TeamPlayerObsFixtureRow[],
  statsByPlayerFixture: ReadonlyMap<string, PlayerObsStatRow[]>,
): TeamPlayerObservationEntry {
  const first = fixtureRows[0];
  const observations = fixtureRows.map((f, i) =>
    buildObservation(f, statsByPlayerFixture.get(compositeKey(f.player_id, f.fixture_id)) ?? [], i + 1),
  );
  const latest = observations[observations.length - 1];
  return {
    player: { id: first.player_id, fullName: first.player_full_name, slug: first.player_slug },
    observationCount: observations.length,
    latestObservation: toLatest(latest),
    participation: countParticipation(observations),
    summary: TEAM_PLAYER_SUMMARY_METRIC_KEYS.map((k) => summarizeMetric(observations, k)),
  };
}

/** Assemble the team-scoped index from Q1 fixture rows (grouped by player, each group
 *  chronological ASC) and Q2 stats. Players are ordered by observationCount DESC, then
 *  fullName ASC, then id ASC — deterministic and reproducible. Pure. */
export function assembleTeamPlayerObservations(
  team: { id: string; name: string; slug: string },
  fixtureRows: readonly TeamPlayerObsFixtureRow[],
  statsByPlayerFixture: ReadonlyMap<string, PlayerObsStatRow[]>,
  opts: { asOf: Date; editionId: string | null },
): TeamPlayerObservationsResponse {
  // Group fixture rows by player, preserving Q1's per-player chronological order.
  const byPlayer = new Map<string, TeamPlayerObsFixtureRow[]>();
  const order: string[] = [];
  for (const row of fixtureRows) {
    let bucket = byPlayer.get(row.player_id);
    if (!bucket) { bucket = []; byPlayer.set(row.player_id, bucket); order.push(row.player_id); }
    bucket.push(row);
  }

  const players = order
    .map((pid) => buildTeamPlayerEntry(byPlayer.get(pid)!, statsByPlayerFixture))
    .sort((a, b) =>
      b.observationCount - a.observationCount ||
      a.player.fullName.localeCompare(b.player.fullName) ||
      (Number(a.player.id) - Number(b.player.id)),
    );

  const scopeKind: 'all' | 'edition' = opts.editionId ? 'edition' : 'all';
  const label = opts.editionId ? `edition ${opts.editionId}` : 'all competitions';
  return {
    team,
    scope: { competition: scopeKind, editionId: opts.editionId, label },
    asOf: opts.asOf.toISOString(),
    playerCount: players.length,
    players,
    provenance: {
      source: 'player_match_statistic',
      readModel: TEAM_PLAYER_OBSERVATION_INDEX_VERSION,
      asOf: opts.asOf.toISOString(),
      teamId: team.id,
      scope: scopeKind,
      editionId: opts.editionId,
    },
  };
}

// ── SQL (read-only) ─────────────────────────────────────────────────────────────
//
// Team ownership is the ANCHOR: player_match_statistic.team_id = :teamId. Because the
// population is anchored on the historical fixture-team, a player's fixtures for OTHER
// teams are excluded at source — no cross-team leakage. Two bounded queries only.
//
// NOTE: player_match_statistic has no team_id-led index today (audited); at current
// scale the team_id scan is acceptable. A (team_id, fixture_partition_on) index is a
// POTENTIAL FUTURE MIGRATION, deliberately NOT introduced here.

/** Q1: eligible team-scoped player × fixture observations, each row carrying the owning
 *  player's identity, the historical team, opponent, result and participation. One row
 *  per (player, fixture). $1 team id · $2 as_of (STRICT <) · $3 edition|null. */
export const TEAM_PLAYER_OBS_FIXTURES_SQL = `
  SELECT pt.player_id::text              AS player_id,
         p.full_name                     AS player_full_name,
         p.slug                          AS player_slug,
         f.id::text                      AS fixture_id,
         f.fixture_partition_on::text    AS fixture_partition_on,
         f.scheduled_kickoff_at          AS kickoff_at,
         (f.home_team_id = pt.team_id)   AS is_home,
         ce.id::text                     AS edition_id,
         ce.season_label                 AS season_label,
         c.id::text                      AS competition_id,
         c.name                          AS competition_name,
         c.slug                          AS competition_slug,
         tm.id::text                     AS team_id,
         tm.name                         AS team_name,
         tm.slug                         AS team_slug,
         o.id::text                      AS opponent_id,
         o.name                          AS opponent_name,
         o.slug                          AS opponent_slug,
         r.home_goals                    AS home_goals,
         r.away_goals                    AS away_goals,
         ls.is_starting                  AS is_starting
    FROM (SELECT DISTINCT player_id, fixture_id, fixture_partition_on, team_id
            FROM football.player_match_statistic
           WHERE team_id = $1::bigint) pt
    JOIN football.player p               ON p.id = pt.player_id
    JOIN football.fixture f              ON f.id = pt.fixture_id AND f.fixture_partition_on = pt.fixture_partition_on
    JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
    JOIN football.competition c          ON c.id = ce.competition_id
    JOIN football.result r               ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
    JOIN football.team tm                ON tm.id = pt.team_id
    JOIN football.team o                 ON o.id = CASE WHEN f.home_team_id = pt.team_id THEN f.away_team_id ELSE f.home_team_id END
    LEFT JOIN football.lineup l          ON l.fixture_id = f.id AND l.fixture_partition_on = f.fixture_partition_on AND l.team_id = pt.team_id
    LEFT JOIN football.lineup_selection ls ON ls.lineup_id = l.id AND ls.fixture_partition_on = l.fixture_partition_on AND ls.player_id = pt.player_id
   WHERE f.lifecycle_state_code = 'COMPLETED'
     AND f.scheduled_kickoff_at < $2::timestamptz
     AND ($3::bigint IS NULL OR f.competition_edition_id = $3::bigint)
   ORDER BY p.full_name ASC, p.id ASC, f.scheduled_kickoff_at ASC, f.id ASC
`;

/** Q2: all canonical stat rows for the eligible (player, fixture) set, scoped to THIS
 *  team so a player's other-team rows can never enter. $1 team id · $2 fixture ids. */
export const TEAM_PLAYER_OBS_STATS_SQL = `
  SELECT pms.player_id::text AS player_id, pms.fixture_id::text AS fixture_id,
         pms.statistic_key AS statistic_key, pms.statistic_value AS statistic_value,
         pms.value_type AS value_type, pms.provider_code AS provider_code,
         pms.retrieved_at AS retrieved_at
    FROM football.player_match_statistic pms
   WHERE pms.team_id = $1::bigint AND pms.fixture_id = ANY($2::bigint[])
   ORDER BY pms.player_id, pms.fixture_id, pms.statistic_key
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

/** Returns the team-scoped observed-player index. The caller (handler) has already
 *  applied the GOVERNED team exposure gate and resolved identity, so `team` is trusted;
 *  a governed team with no eligible observations yields an empty index (playerCount 0).
 *  Two bounded queries: fixtures + one stats query — no per-player / per-fixture N+1. */
export async function readTeamPlayerObservations(
  tx: PoolClient,
  team: { id: string; name: string; slug: string },
  options: TeamPlayerObservationsOptions = {},
): Promise<TeamPlayerObservationsResponse> {
  const asOf = options.asOf ?? new Date();
  const editionId = options.editionId ?? null;

  const fixturesRes = await tx.query<TeamPlayerObsFixtureRow>(TEAM_PLAYER_OBS_FIXTURES_SQL, [team.id, asOf, editionId]);
  const fixtureRows = fixturesRes.rows;

  const statsByPlayerFixture = new Map<string, PlayerObsStatRow[]>();
  if (fixtureRows.length > 0) {
    const ids = Array.from(new Set(fixtureRows.map((f) => f.fixture_id)));
    const statsRes = await tx.query<TeamPlayerObsStatRow>(TEAM_PLAYER_OBS_STATS_SQL, [team.id, ids]);
    for (const row of statsRes.rows) {
      const k = compositeKey(row.player_id, row.fixture_id);
      const bucket = statsByPlayerFixture.get(k) ?? [];
      bucket.push(row);
      statsByPlayerFixture.set(k, bucket);
    }
  }

  return assembleTeamPlayerObservations(team, fixtureRows, statsByPlayerFixture, { asOf, editionId });
}
