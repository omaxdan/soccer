// ─────────────────────────────────────────────────────────────────────────────
// V2 FIXTURE READINESS — read-only substrate audit (no writes, no intelligence)
//
//   npm run readiness:v2 -- --fixture 61
//
// A DB-backed diagnostic for the "reference fixture" data-foundation work. It reports
// exactly what REAL substrate exists behind one fixture — team history, player data,
// competition breadth and sealed-snapshot coverage — so we can decide whether a
// fixture is data-complete enough to develop UI against. It CALCULATES NO
// INTELLIGENCE and WRITES NOTHING: pure SELECTs over persisted state.
//
// Absence is reported honestly as 0/— (never inferred, never zero-washed into a
// claim). The operator runs it with their own .env; this file holds only the
// governed read queries and a pure formatter.
// ─────────────────────────────────────────────────────────────────────────────

import '../config/env';

import type { PoolClient } from 'pg';
import { withConnection } from '../db/tx';
import { closeAllPools } from '../db/pool';

const READ_ROLE = 'pt_platform_admin' as const;

// ── report shape (pure, DB-free) ────────────────────────────────────────────────

export interface TeamCoverage {
  readonly teamId: string;
  readonly name: string;
  readonly side: 'HOME' | 'AWAY';
  readonly completedHistory: number;
  readonly competitionsViaFixtures: number;
  readonly competitionsViaRegistration: number;
  readonly editionsViaFixtures: number;
  readonly teamFeatureKeys: number;
}

export interface PlayerCoverage {
  readonly teamId: string;
  readonly name: string;
  readonly side: 'HOME' | 'AWAY';
  readonly registeredPlayers: number;
  readonly playersWithMatchStats: number;
  readonly distinctStatisticKeys: number;
  readonly availabilityRecords: number;
  readonly valuationRecords: number;
  readonly appearanceRecords: number;
}

export interface MatchCoverage {
  readonly snapshots: number;
  readonly sealedSnapshots: number;
  readonly citedEvidenceRows: number;
  readonly governedModuleReadings: number;
}

export interface ReadinessReport {
  readonly fixture: {
    readonly id: string; readonly competition: string; readonly editionId: string;
    readonly season: string; readonly kickoff: string; readonly status: string;
    readonly home: { readonly id: string; readonly name: string };
    readonly away: { readonly id: string; readonly name: string };
  } | null;
  readonly teams: readonly TeamCoverage[];
  readonly players: readonly PlayerCoverage[];
  readonly match: MatchCoverage;
}

// ── pure formatter (unit-tested) ────────────────────────────────────────────────

function pad(label: string, value: number | string): string {
  return `    ${label.padEnd(28)}${value}`;
}

/** Render the report as plain text. Pure — no DB, no intelligence. */
export function formatReadinessReport(r: ReadinessReport): string {
  const lines: string[] = [];
  lines.push('\nV2 FIXTURE READINESS — read-only substrate audit (no writes, no intelligence)\n');
  if (!r.fixture) {
    lines.push('  REFERENCE FIXTURE  not found (no such fixture id)\n');
    return lines.join('\n');
  }
  const f = r.fixture;
  lines.push('REFERENCE FIXTURE');
  lines.push(pad('fixture', f.id));
  lines.push(pad('competition', f.competition));
  lines.push(pad('edition / season', `${f.editionId} / ${f.season}`));
  lines.push(pad('kickoff', f.kickoff));
  lines.push(pad('status', f.status));
  lines.push(pad('home', `${f.home.name} (${f.home.id})`));
  lines.push(pad('away', `${f.away.name} (${f.away.id})`));

  lines.push('\nTEAM COVERAGE');
  for (const t of r.teams) {
    lines.push(`  [${t.side}] ${t.name} (${t.teamId})`);
    lines.push(pad('completed history', t.completedHistory));
    lines.push(pad('competitions (fixtures)', t.competitionsViaFixtures));
    lines.push(pad('competitions (registration)', t.competitionsViaRegistration));
    lines.push(pad('editions (fixtures)', t.editionsViaFixtures));
    lines.push(pad('team feature keys', t.teamFeatureKeys));
  }

  lines.push('\nPLAYER COVERAGE');
  for (const p of r.players) {
    lines.push(`  [${p.side}] ${p.name} (${p.teamId})`);
    lines.push(pad('registered players', p.registeredPlayers));
    lines.push(pad('players with match stats', p.playersWithMatchStats));
    lines.push(pad('distinct statistic keys', p.distinctStatisticKeys));
    lines.push(pad('availability records', p.availabilityRecords));
    lines.push(pad('valuation records', p.valuationRecords));
    lines.push(pad('appearance records', p.appearanceRecords));
  }

  lines.push(`\nMATCH COVERAGE (fixture ${f.id})`);
  lines.push(pad('snapshots', r.match.snapshots));
  lines.push(pad('sealed snapshots', r.match.sealedSnapshots));
  lines.push(pad('cited evidence rows', r.match.citedEvidenceRows));
  lines.push(pad('governed module readings', r.match.governedModuleReadings));
  lines.push('\n  Absence is shown as 0 honestly — nothing here is fabricated or intelligence.\n');
  return lines.join('\n');
}

// ── DB read (read-only) ─────────────────────────────────────────────────────────

const FIXTURE_SQL = `
  SELECT f.id::text AS id, c.name AS competition, ce.id::text AS edition_id, ce.season_label AS season,
         to_char(f.scheduled_kickoff_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS kickoff,
         f.lifecycle_state_code AS status,
         f.home_team_id::text AS home_id, ht.name AS home_name,
         f.away_team_id::text AS away_id, at.name AS away_name
    FROM football.fixture f
    JOIN football.competition_edition ce ON ce.id = f.competition_edition_id
    JOIN football.competition c ON c.id = ce.competition_id
    JOIN football.team ht ON ht.id = f.home_team_id
    JOIN football.team at ON at.id = f.away_team_id
   WHERE f.id = $1::bigint
`;

const TEAM_COVERAGE_SQL = `
  SELECT
    (SELECT count(*) FROM football.fixture f
       WHERE (f.home_team_id=$1 OR f.away_team_id=$1) AND f.lifecycle_state_code='COMPLETED') AS completed_history,
    (SELECT count(DISTINCT ce.competition_id) FROM football.fixture f
       JOIN football.competition_edition ce ON ce.id=f.competition_edition_id
       WHERE f.home_team_id=$1 OR f.away_team_id=$1) AS competitions_fixtures,
    (SELECT count(DISTINCT ce.competition_id) FROM football.team_registration tr
       JOIN football.competition_edition ce ON ce.id=tr.competition_edition_id
       WHERE tr.team_id=$1) AS competitions_registration,
    (SELECT count(DISTINCT f.competition_edition_id) FROM football.fixture f
       WHERE f.home_team_id=$1 OR f.away_team_id=$1) AS editions_fixtures,
    (SELECT count(DISTINCT fv.feature_definition_id) FROM feature.feature_value fv
       WHERE fv.subject_team_id=$1) AS team_feature_keys
`;

const PLAYER_COVERAGE_SQL = `
  SELECT
    (SELECT count(*) FROM football.player_registration pr
       WHERE pr.team_id=$1 AND pr.registration_kind_code<>'LOAN_OUT' AND pr.registration_period @> current_date) AS registered_players,
    (SELECT count(DISTINCT pms.player_id) FROM football.player_match_statistic pms WHERE pms.team_id=$1) AS players_with_stats,
    (SELECT count(DISTINCT pms.statistic_key) FROM football.player_match_statistic pms WHERE pms.team_id=$1) AS statistic_keys,
    (SELECT count(*) FROM football.player_availability pa
       JOIN football.player_registration pr ON pr.player_id=pa.player_id AND pr.team_id=$1) AS availability_records,
    (SELECT count(*) FROM football.player_valuation v
       JOIN football.player_registration pr ON pr.player_id=v.player_id AND pr.team_id=$1) AS valuation_records,
    (SELECT count(*) FROM football.appearance a WHERE a.team_id=$1) AS appearance_records
`;

const MATCH_COVERAGE_SQL = `
  SELECT
    (SELECT count(*) FROM snapshot.match_snapshot ms WHERE ms.fixture_id=$1) AS snapshots,
    (SELECT count(*) FROM snapshot.match_snapshot ms WHERE ms.fixture_id=$1 AND ms.sealed_at IS NOT NULL) AS sealed_snapshots,
    (SELECT count(*) FROM snapshot.snapshot_feature_state sfs
       JOIN snapshot.match_snapshot ms ON ms.id=sfs.match_snapshot_id AND ms.fixture_partition_on=sfs.fixture_partition_on
       WHERE ms.fixture_id=$1) AS cited_evidence_rows,
    (SELECT count(*) FROM snapshot.snapshot_module_reading smr
       JOIN snapshot.match_snapshot ms ON ms.id=smr.match_snapshot_id AND ms.fixture_partition_on=smr.fixture_partition_on
       WHERE ms.fixture_id=$1) AS governed_module_readings
`;

async function teamCoverage(tx: PoolClient, teamId: string, name: string, side: 'HOME' | 'AWAY'): Promise<TeamCoverage> {
  const { rows } = await tx.query(TEAM_COVERAGE_SQL, [teamId]);
  const r = rows[0];
  return {
    teamId, name, side,
    completedHistory: Number(r.completed_history),
    competitionsViaFixtures: Number(r.competitions_fixtures),
    competitionsViaRegistration: Number(r.competitions_registration),
    editionsViaFixtures: Number(r.editions_fixtures),
    teamFeatureKeys: Number(r.team_feature_keys),
  };
}

async function playerCoverage(tx: PoolClient, teamId: string, name: string, side: 'HOME' | 'AWAY'): Promise<PlayerCoverage> {
  const { rows } = await tx.query(PLAYER_COVERAGE_SQL, [teamId]);
  const r = rows[0];
  return {
    teamId, name, side,
    registeredPlayers: Number(r.registered_players),
    playersWithMatchStats: Number(r.players_with_stats),
    distinctStatisticKeys: Number(r.statistic_keys),
    availabilityRecords: Number(r.availability_records),
    valuationRecords: Number(r.valuation_records),
    appearanceRecords: Number(r.appearance_records),
  };
}

export async function readFixtureReadiness(tx: PoolClient, fixtureId: string): Promise<ReadinessReport> {
  const fx = await tx.query(FIXTURE_SQL, [fixtureId]);
  if (fx.rows.length === 0) {
    return { fixture: null, teams: [], players: [], match: { snapshots: 0, sealedSnapshots: 0, citedEvidenceRows: 0, governedModuleReadings: 0 } };
  }
  const f = fx.rows[0];
  const [homeTC, awayTC, homePC, awayPC, mc] = await Promise.all([
    teamCoverage(tx, f.home_id, f.home_name, 'HOME'),
    teamCoverage(tx, f.away_id, f.away_name, 'AWAY'),
    playerCoverage(tx, f.home_id, f.home_name, 'HOME'),
    playerCoverage(tx, f.away_id, f.away_name, 'AWAY'),
    tx.query(MATCH_COVERAGE_SQL, [fixtureId]),
  ]);
  const m = mc.rows[0];
  return {
    fixture: {
      id: f.id, competition: f.competition, editionId: f.edition_id, season: f.season,
      kickoff: f.kickoff, status: f.status,
      home: { id: f.home_id, name: f.home_name }, away: { id: f.away_id, name: f.away_name },
    },
    teams: [homeTC, awayTC],
    players: [homePC, awayPC],
    match: {
      snapshots: Number(m.snapshots), sealedSnapshots: Number(m.sealed_snapshots),
      citedEvidenceRows: Number(m.cited_evidence_rows), governedModuleReadings: Number(m.governed_module_readings),
    },
  };
}

function parseFixtureArg(argv: readonly string[]): string {
  const i = argv.indexOf('--fixture');
  const raw = i >= 0 ? argv[i + 1] : undefined;
  if (!raw || !/^[1-9][0-9]{0,18}$/.test(raw)) {
    throw new Error('Usage: npm run readiness:v2 -- --fixture <fixtureId>  (fixtureId is a positive integer)');
  }
  return raw;
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const fixtureId = parseFixtureArg(argv);
  const report = await withConnection(READ_ROLE, (tx) => readFixtureReadiness(tx, fixtureId));
  // eslint-disable-next-line no-console
  console.log(formatReadinessReport(report));
}

if (require.main === module) {
  main()
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('\nv2 readiness FAILED:', error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    })
    .finally(() => { void closeAllPools(); });
}
