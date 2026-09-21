// ─────────────────────────────────────────────────────────────────────────────
// STATISTICAL ENRICHMENT DEMAND PLANNER + LAYER-2 UNLOCK CHECKER (read-only)
//
// Answers, BEFORE any provider call:
//   • how many `match_statistics` calls a scope needs (ONE fixture = ONE call = BOTH
//     team sides — never counted twice);
//   • which completed fixtures are missing team-stat coverage;
//   • each team's shortfall toward the attribute floor, and the SMALLEST deterministic
//     fixture set that lifts under-covered teams toward it;
//   • forward 24/48/72h scheduled demand (to protect near-term budget);
//   • whether Layer-2 statistical attributes may reopen (per-metric usable coverage vs a
//     governed representative-population threshold).
//
// Read-only and spends nothing. Eligibility mirrors the governed contract: COMPLETED +
// result-bearing, strict `scheduled_kickoff_at < asOf`, edition-scoped, and — for the
// unlock check — a USABLE oriented value (non-null, numeric), de-duplicated per fixture
// so team_match_statistic group_name multiplicity cannot inflate coverage.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

/** The representative dense key used as the presence marker for "team-stat coverage". */
export const DEFAULT_COVERAGE_KEY = 'totalShotsOnGoal';
export const BENCHMARK_FLOOR = 5;
export const ATTRIBUTE_FLOOR = 8;

// ── wire types ────────────────────────────────────────────────────────────────

export interface MissingFixture {
  readonly fixtureId: string;
  readonly fixturePartitionOn: string;
  readonly kickoffAt: string;
  readonly homeTeamId: string;
  readonly awayTeamId: string;
}

export interface TeamShortfall {
  readonly teamId: string;
  readonly covered: number;
  readonly shortfall: number; // max(0, floor − covered)
}

export interface EnrichmentDemand {
  readonly editionId: string;
  readonly asOf: string;
  readonly coverageKey: string;
  readonly attributeFloor: number;
  readonly completedFixtures: number;
  readonly coveredFixtures: number;
  readonly missingFixtures: number;
  readonly callsForFullBackfill: number; // == missingFixtures (1 call per fixture, both sides)
  readonly teams: readonly TeamShortfall[];
  readonly teamsBelowFloor: number;
  readonly missing: readonly MissingFixture[];
}

export interface TargetedSelection {
  readonly selectedFixtureIds: readonly string[];
  readonly calls: number; // == selectedFixtureIds.length
  readonly teamsAtFloorBefore: number;
  readonly teamsAtFloorAfter: number;
  readonly teamsStillShort: number;
}

export interface ForwardDemand {
  readonly next24h: number;
  readonly next48h: number; // scheduled fixtures within 48h (includes the 24h subset)
  readonly next72h: number;
}

export interface Layer2KeyStatus {
  readonly key: string;
  readonly teamsAnyUsable: number;
  readonly teamsGe5Usable: number;
  readonly teamsGe8Usable: number;
  readonly teamsGe8Percent: number; // teamsGe8Usable / editionTeams
  readonly unlocked: boolean;
}

export interface Layer2UnlockStatus {
  readonly editionId: string;
  readonly asOf: string;
  readonly editionTeams: number;
  readonly thresholdPercent: number;
  readonly attributeFloor: number;
  readonly keys: readonly Layer2KeyStatus[];
  readonly anyUnlocked: boolean;
}

// ── pure planning ───────────────────────────────────────────────────────────────

/** Per-team shortfall toward the attribute floor. Teams with no covered fixtures still
 *  appear (covered 0) when present in `allTeams`. Pure. */
export function teamShortfalls(coveredByTeam: ReadonlyMap<string, number>, allTeams: readonly string[], floor: number): TeamShortfall[] {
  return allTeams
    .map((teamId) => {
      const covered = coveredByTeam.get(teamId) ?? 0;
      return { teamId, covered, shortfall: Math.max(0, floor - covered) };
    })
    .sort((a, b) => b.shortfall - a.shortfall || Number(a.teamId) - Number(b.teamId));
}

/** Smallest deterministic fixture set lifting under-covered teams toward the floor.
 *  Greedy: repeatedly take the missing fixture covering the MOST still-short teams
 *  (tie → earliest kickoff, then fixtureId); stop when no missing fixture reduces any
 *  team's shortfall. One selected fixture = one `match_statistics` call (both sides). Pure. */
export function selectTargetedFixtures(
  missing: readonly MissingFixture[],
  coveredByTeam: ReadonlyMap<string, number>,
  floor: number,
): TargetedSelection {
  const covered = new Map(coveredByTeam);
  const short = (teamId: string): boolean => (covered.get(teamId) ?? 0) < floor;
  const teamsAtFloor = (): number => [...covered.values()].filter((c) => c >= floor).length;
  const allTeamsAtFloorBefore = teamsAtFloor();

  const remaining = [...missing].sort((a, b) => (a.kickoffAt < b.kickoffAt ? -1 : a.kickoffAt > b.kickoffAt ? 1 : Number(a.fixtureId) - Number(b.fixtureId)));
  const selected: string[] = [];

  for (;;) {
    let best: MissingFixture | null = null;
    let bestGain = 0;
    let bestIdx = -1;
    for (let i = 0; i < remaining.length; i++) {
      const f = remaining[i];
      const gain = (short(f.homeTeamId) ? 1 : 0) + (short(f.awayTeamId) ? 1 : 0);
      if (gain > bestGain) { best = f; bestGain = gain; bestIdx = i; }
    }
    if (best === null || bestGain === 0) break; // no fixture reduces any shortfall
    selected.push(best.fixtureId);
    covered.set(best.homeTeamId, (covered.get(best.homeTeamId) ?? 0) + 1);
    covered.set(best.awayTeamId, (covered.get(best.awayTeamId) ?? 0) + 1);
    remaining.splice(bestIdx, 1);
  }

  const teamsStillShort = [...covered.entries()].filter(([, c]) => c < floor).length;
  return { selectedFixtureIds: selected, calls: selected.length, teamsAtFloorBefore: allTeamsAtFloorBefore, teamsAtFloorAfter: teamsAtFloor(), teamsStillShort };
}

/** Per-key unlock evaluation against the governed representative-population threshold. Pure. */
export function evaluateUnlock(
  perKey: ReadonlyArray<{ key: string; teamsAny: number; teamsGe5: number; teamsGe8: number }>,
  editionTeams: number,
  thresholdPercent: number,
  attributeFloor: number,
): Layer2UnlockStatus['keys'] {
  return perKey.map((k) => {
    const pct = editionTeams > 0 ? k.teamsGe8 / editionTeams : 0;
    return {
      key: k.key, teamsAnyUsable: k.teamsAny, teamsGe5Usable: k.teamsGe5, teamsGe8Usable: k.teamsGe8,
      teamsGe8Percent: Math.round(pct * 10000) / 10000,
      unlocked: pct >= thresholdPercent && attributeFloor === ATTRIBUTE_FLOOR,
    };
  });
}

// ── SQL (read-only) ─────────────────────────────────────────────────────────────

export const DEMAND_COUNTS_SQL = `
  SELECT
    count(*) AS completed,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM football.team_match_statistic s
       WHERE s.fixture_id = f.id AND s.fixture_partition_on = f.fixture_partition_on
         AND s.statistic_key = $3::text AND s.period = 'ALL')) AS covered
    FROM football.fixture f
   WHERE f.competition_edition_id = $1::bigint AND f.lifecycle_state_code = 'COMPLETED'
     AND f.scheduled_kickoff_at < $2::timestamptz
`;

export const MISSING_FIXTURES_SQL = `
  SELECT f.id::text AS fixture_id, f.fixture_partition_on::text AS fixture_partition_on,
         f.scheduled_kickoff_at AS kickoff_at, f.home_team_id::text AS home_team_id, f.away_team_id::text AS away_team_id
    FROM football.fixture f
   WHERE f.competition_edition_id = $1::bigint AND f.lifecycle_state_code = 'COMPLETED'
     AND f.scheduled_kickoff_at < $2::timestamptz
     AND NOT EXISTS (SELECT 1 FROM football.team_match_statistic s
                      WHERE s.fixture_id = f.id AND s.fixture_partition_on = f.fixture_partition_on
                        AND s.statistic_key = $3::text AND s.period = 'ALL')
   ORDER BY f.scheduled_kickoff_at, f.id
`;

export const COVERED_PER_TEAM_SQL = `
  WITH cov AS (
    SELECT f.id, f.fixture_partition_on, f.home_team_id, f.away_team_id
      FROM football.fixture f
     WHERE f.competition_edition_id = $1::bigint AND f.lifecycle_state_code = 'COMPLETED'
       AND f.scheduled_kickoff_at < $2::timestamptz
       AND EXISTS (SELECT 1 FROM football.team_match_statistic s
                    WHERE s.fixture_id = f.id AND s.fixture_partition_on = f.fixture_partition_on
                      AND s.statistic_key = $3::text AND s.period = 'ALL'))
  SELECT team_id::text AS team_id, count(*) AS covered FROM (
    SELECT home_team_id AS team_id FROM cov UNION ALL SELECT away_team_id FROM cov) z
   GROUP BY team_id
`;

/** Distinct teams in the edition's completed fixtures before asOf (population size). */
export const EDITION_TEAMS_SQL = `
  SELECT count(DISTINCT t)::text AS teams FROM (
    SELECT home_team_id t FROM football.fixture
     WHERE competition_edition_id = $1::bigint AND lifecycle_state_code = 'COMPLETED' AND scheduled_kickoff_at < $2::timestamptz
    UNION SELECT away_team_id FROM football.fixture
     WHERE competition_edition_id = $1::bigint AND lifecycle_state_code = 'COMPLETED' AND scheduled_kickoff_at < $2::timestamptz) x
`;

export const FORWARD_DEMAND_SQL = `
  SELECT
    count(*) FILTER (WHERE scheduled_kickoff_at <= $2::timestamptz + interval '24 hours') AS n24,
    count(*) FILTER (WHERE scheduled_kickoff_at <= $2::timestamptz + interval '48 hours') AS n48,
    count(*) FILTER (WHERE scheduled_kickoff_at <= $2::timestamptz + interval '72 hours') AS n72
    FROM football.fixture
   WHERE competition_edition_id = $1::bigint AND lifecycle_state_code = 'SCHEDULED'
     AND scheduled_kickoff_at > $2::timestamptz
`;

/** Per-key USABLE coverage: a fixture counts for a team only when that team's oriented
 *  value is numeric; de-duplicated per fixture so group_name multiplicity cannot inflate.
 *  $1 edition · $2 asOf (strict <) · $3 keys[]. */
export const UNLOCK_USABLE_SQL = `
  WITH ed AS (
    SELECT id, fixture_partition_on, home_team_id, away_team_id
      FROM football.fixture
     WHERE competition_edition_id = $1::bigint AND lifecycle_state_code = 'COMPLETED'
       AND scheduled_kickoff_at < $2::timestamptz),
  oriented AS (
    SELECT s.statistic_key AS key, ed.home_team_id AS team, ed.id AS fixture
      FROM ed JOIN football.team_match_statistic s
        ON s.fixture_id = ed.id AND s.fixture_partition_on = ed.fixture_partition_on
       AND s.period = 'ALL' AND s.statistic_key = ANY($3::text[])
     WHERE s.home_value ~ '^-?[0-9.]+$'
    UNION ALL
    SELECT s.statistic_key, ed.away_team_id, ed.id
      FROM ed JOIN football.team_match_statistic s
        ON s.fixture_id = ed.id AND s.fixture_partition_on = ed.fixture_partition_on
       AND s.period = 'ALL' AND s.statistic_key = ANY($3::text[])
     WHERE s.away_value ~ '^-?[0-9.]+$'),
  per_team AS (SELECT key, team, count(DISTINCT fixture) AS c FROM oriented GROUP BY key, team)
  SELECT key,
         count(*)::text AS teams_any,
         count(*) FILTER (WHERE c >= 5)::text AS teams_ge5,
         count(*) FILTER (WHERE c >= 8)::text AS teams_ge8
    FROM per_team GROUP BY key ORDER BY key
`;

// ── DB reads (assemble pure pieces) ─────────────────────────────────────────────

interface MissingRow { fixture_id: string; fixture_partition_on: string; kickoff_at: Date | string; home_team_id: string; away_team_id: string }
const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export async function readEditionEnrichmentDemand(
  tx: PoolClient, editionId: string,
  options: { asOf?: Date; coverageKey?: string; attributeFloor?: number } = {},
): Promise<EnrichmentDemand> {
  const asOf = options.asOf ?? new Date();
  const coverageKey = options.coverageKey ?? DEFAULT_COVERAGE_KEY;
  const attributeFloor = options.attributeFloor ?? ATTRIBUTE_FLOOR;

  const counts = await tx.query<{ completed: string; covered: string }>(DEMAND_COUNTS_SQL, [editionId, asOf, coverageKey]);
  const missingRes = await tx.query<MissingRow>(MISSING_FIXTURES_SQL, [editionId, asOf, coverageKey]);
  const perTeam = await tx.query<{ team_id: string; covered: string }>(COVERED_PER_TEAM_SQL, [editionId, asOf, coverageKey]);

  const completedFixtures = Number(counts.rows[0]?.completed ?? 0);
  const coveredFixtures = Number(counts.rows[0]?.covered ?? 0);
  const coveredByTeam = new Map(perTeam.rows.map((r) => [r.team_id, Number(r.covered)]));

  // The full team population = distinct teams in completed fixtures (some may have 0 covered).
  const allTeams = await tx.query<{ t: string }>(
    `SELECT home_team_id::text t FROM football.fixture WHERE competition_edition_id=$1::bigint AND lifecycle_state_code='COMPLETED' AND scheduled_kickoff_at<$2::timestamptz
     UNION SELECT away_team_id::text FROM football.fixture WHERE competition_edition_id=$1::bigint AND lifecycle_state_code='COMPLETED' AND scheduled_kickoff_at<$2::timestamptz`,
    [editionId, asOf],
  );
  const teams = teamShortfalls(coveredByTeam, allTeams.rows.map((r) => r.t), attributeFloor);
  const missing: MissingFixture[] = missingRes.rows.map((r) => ({
    fixtureId: r.fixture_id, fixturePartitionOn: r.fixture_partition_on, kickoffAt: iso(r.kickoff_at),
    homeTeamId: r.home_team_id, awayTeamId: r.away_team_id,
  }));

  return {
    editionId, asOf: asOf.toISOString(), coverageKey, attributeFloor,
    completedFixtures, coveredFixtures, missingFixtures: missing.length,
    callsForFullBackfill: missing.length,
    teams, teamsBelowFloor: teams.filter((t) => t.shortfall > 0).length, missing,
  };
}

export async function readForwardDemand(tx: PoolClient, editionId: string, asOf: Date = new Date()): Promise<ForwardDemand> {
  const res = await tx.query<{ n24: string; n48: string; n72: string }>(FORWARD_DEMAND_SQL, [editionId, asOf]);
  const r = res.rows[0];
  return { next24h: Number(r?.n24 ?? 0), next48h: Number(r?.n48 ?? 0), next72h: Number(r?.n72 ?? 0) };
}

export async function readLayer2UnlockStatus(
  tx: PoolClient, editionId: string,
  options: { asOf?: Date; keys?: readonly string[]; thresholdPercent: number; attributeFloor?: number },
): Promise<Layer2UnlockStatus> {
  const asOf = options.asOf ?? new Date();
  const keys = options.keys ?? ['totalShotsOnGoal', 'ballPossession', 'expectedGoals'];
  const attributeFloor = options.attributeFloor ?? ATTRIBUTE_FLOOR;

  const teamsRes = await tx.query<{ teams: string }>(EDITION_TEAMS_SQL, [editionId, asOf]);
  const editionTeams = Number(teamsRes.rows[0]?.teams ?? 0);
  const rows = await tx.query<{ key: string; teams_any: string; teams_ge5: string; teams_ge8: string }>(UNLOCK_USABLE_SQL, [editionId, asOf, [...keys]]);
  const perKey = rows.rows.map((r) => ({ key: r.key, teamsAny: Number(r.teams_any), teamsGe5: Number(r.teams_ge5), teamsGe8: Number(r.teams_ge8) }));
  const evaluated = evaluateUnlock(perKey, editionTeams, options.thresholdPercent, attributeFloor);
  return {
    editionId, asOf: asOf.toISOString(), editionTeams, thresholdPercent: options.thresholdPercent,
    attributeFloor, keys: evaluated, anyUnlocked: evaluated.some((k) => k.unlocked),
  };
}
