// TEAM PLAYER OBSERVATION INDEX read-model tests (DB-free, pure + captured-tx).
//
// Proves the locked governance and Player-Observation parity:
//   • OBSERVED players (stat-anchored), grouped from team-scoped fixture rows
//   • historical team ownership is the ANCHOR — the SQL filters player_match_statistic
//     by team_id, so a player's other-team fixtures cannot enter (no cross-team leak)
//   • strict `< asOf`, COMPLETED, result-join, edition filter, read-only SQL
//   • latest = chronologically last eligible observation (kickoff/fixture ASC)
//   • summary SUM with missing ≠ zero + coverage; participation counts
//   • deterministic player ordering; two bounded queries (no per-player/per-fixture N+1)

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  summarizeMetric, countParticipation, buildTeamPlayerEntry, assembleTeamPlayerObservations,
  readTeamPlayerObservations,
  TEAM_PLAYER_OBS_FIXTURES_SQL, TEAM_PLAYER_OBS_STATS_SQL, TEAM_PLAYER_SUMMARY_METRIC_KEYS,
  type TeamPlayerObsFixtureRow,
} from '../teamPlayerObservations';
import type { PlayerObsStatRow } from '../playerObservations';

// ── fixtures ──────────────────────────────────────────────────────────────────

const TEAM = { id: '72', name: 'Palmeiras', slug: 'palmeiras-1963' };

/** One team-scoped fixture row for a player. Defaults describe a home win vs opponent 8. */
function fixtureRow(playerId: string, playerName: string, fixtureId: string, kickoff: string, over: Partial<TeamPlayerObsFixtureRow> = {}): TeamPlayerObsFixtureRow {
  return {
    player_id: playerId, player_full_name: playerName, player_slug: `p-${playerId}`,
    fixture_id: fixtureId, fixture_partition_on: '2026-01-01', kickoff_at: kickoff, is_home: true,
    edition_id: '18', season_label: 'Brasileiro Serie A 2026',
    competition_id: '28', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano-325',
    team_id: '72', team_name: 'Palmeiras', team_slug: 'palmeiras-1963',
    opponent_id: '8', opponent_name: 'Opp', opponent_slug: 'opp',
    home_goals: 2, away_goals: 0, is_starting: true,
    ...over,
  };
}

const stat = (playerId: string, fixtureId: string, key: string, value: string | null, value_type = 'number'): PlayerObsStatRow & { player_id: string } => ({
  player_id: playerId, fixture_id: fixtureId, statistic_key: key, statistic_value: value,
  value_type, provider_code: 'PROV', retrieved_at: '2026-02-02T00:00:00.000Z',
});

function statsMap(rows: (PlayerObsStatRow & { player_id: string })[]): Map<string, PlayerObsStatRow[]> {
  const m = new Map<string, PlayerObsStatRow[]>();
  for (const r of rows) {
    const k = `${r.player_id}|${r.fixture_id}`;
    const b = m.get(k) ?? []; b.push(r); m.set(k, b);
  }
  return m;
}

// ── pure summary / participation ─────────────────────────────────────────────

describe('Team Player Index · summary + participation', () => {
  test('summarizeMetric sums present values; absent key → total null (missing ≠ zero)', () => {
    const rows = [fixtureRow('9', 'A', '1', '2026-02-01T00:00:00Z'), fixtureRow('9', 'A', '2', '2026-02-08T00:00:00Z')];
    const entry = buildTeamPlayerEntry(rows, statsMap([
      stat('9', '1', 'goals', '1'), stat('9', '1', 'minutesPlayed', '90'),
      stat('9', '2', 'goals', '0'), stat('9', '2', 'minutesPlayed', '75'),
      // no expectedGoals / totalShots anywhere → those totals must be null
    ]));
    const goals = entry.summary.find((s) => s.key === 'goals')!;
    assert.deepEqual(goals, { key: 'goals', total: 1, present: 2, totalObservations: 2 }); // 1 + 0, both present
    const mins = entry.summary.find((s) => s.key === 'minutesPlayed')!;
    assert.equal(mins.total, 165);
    const xg = entry.summary.find((s) => s.key === 'expectedGoals')!;
    assert.deepEqual(xg, { key: 'expectedGoals', total: null, present: 0, totalObservations: 2 }); // absent ≠ 0
  });

  test('a real "0" is preserved (not treated as missing)', () => {
    const g = summarizeMetric([{ metrics: [{ key: 'goals', value: 0, display: null }] } as any], 'goals');
    assert.deepEqual(g, { key: 'goals', total: 0, present: 1, totalObservations: 1 });
  });

  test('participation counts STARTED/BENCH/UNKNOWN from observations only', () => {
    const rows = [
      fixtureRow('9', 'A', '1', '2026-02-01T00:00:00Z', { is_starting: true }),
      fixtureRow('9', 'A', '2', '2026-02-08T00:00:00Z', { is_starting: false }),
      fixtureRow('9', 'A', '3', '2026-02-15T00:00:00Z', { is_starting: null }),
    ];
    const entry = buildTeamPlayerEntry(rows, statsMap([]));
    assert.deepEqual(entry.participation, { started: 1, bench: 1, unknown: 1 });
  });

  test('summary keys are exactly the four locked headline metrics', () => {
    assert.deepEqual([...TEAM_PLAYER_SUMMARY_METRIC_KEYS], ['minutesPlayed', 'goals', 'expectedGoals', 'totalShots']);
  });
});

// ── latest observation + ordering ────────────────────────────────────────────

describe('Team Player Index · latest observation + ordering', () => {
  test('latestObservation is the chronologically last eligible fixture', () => {
    const rows = [
      fixtureRow('9', 'A', '1', '2026-02-01T00:00:00Z', { opponent_id: '8', opponent_name: 'First', opponent_slug: 'first' }),
      fixtureRow('9', 'A', '2', '2026-02-26T00:00:00Z', { opponent_id: '67', opponent_name: 'Last', opponent_slug: 'last' }),
    ];
    const entry = buildTeamPlayerEntry(rows, statsMap([]));
    assert.equal(entry.observationCount, 2);
    assert.equal(entry.latestObservation.fixtureId, '2');
    assert.equal(entry.latestObservation.opponent.name, 'Last');
    assert.equal(entry.latestObservation.kickoffAt, '2026-02-26T00:00:00.000Z');
  });

  test('players ordered by observationCount DESC, then fullName ASC', () => {
    const rows: TeamPlayerObsFixtureRow[] = [
      fixtureRow('9', 'Zico', '1', '2026-02-01T00:00:00Z'),
      fixtureRow('10', 'Ademir', '2', '2026-02-01T00:00:00Z'),
      fixtureRow('10', 'Ademir', '3', '2026-02-08T00:00:00Z'),
    ];
    const res = assembleTeamPlayerObservations(TEAM, rows, statsMap([]), { asOf: new Date('2026-03-01T00:00:00Z'), editionId: null });
    assert.deepEqual(res.players.map((p) => p.player.fullName), ['Ademir', 'Zico']); // Ademir has 2 obs → first
    assert.equal(res.playerCount, 2);
  });
});

// ── scope + provenance ───────────────────────────────────────────────────────

describe('Team Player Index · scope-honest labelling + provenance', () => {
  test('no edition → ALL-COMPETITIONS label (never "league season")', () => {
    const res = assembleTeamPlayerObservations(TEAM, [], statsMap([]), { asOf: new Date('2026-03-01T00:00:00Z'), editionId: null });
    assert.equal(res.scope.competition, 'all');
    assert.equal(res.scope.label, 'all competitions');
    assert.equal(res.playerCount, 0);
    assert.deepEqual(res.players, []);
    assert.doesNotMatch(JSON.stringify(res), /league season/i);
    assert.equal(res.provenance.source, 'player_match_statistic');
    assert.equal(res.provenance.teamId, '72');
  });

  test('edition scope carries editionId and an edition label', () => {
    const res = assembleTeamPlayerObservations(TEAM, [], statsMap([]), { asOf: new Date('2026-03-01T00:00:00Z'), editionId: '18' });
    assert.equal(res.scope.competition, 'edition');
    assert.equal(res.scope.editionId, '18');
    assert.equal(res.scope.label, 'edition 18');
    assert.equal(res.provenance.editionId, '18');
  });
});

// ── SQL shape (team anchor, leak-free, read-only) ─────────────────────────────

describe('Team Player Index · SQL shape', () => {
  test('fixtures SQL anchors on team_id, strict `< $2`, COMPLETED, result join, edition filter, ASC order, read-only', () => {
    const s = TEAM_PLAYER_OBS_FIXTURES_SQL;
    assert.match(s, /FROM football\.player_match_statistic\s+WHERE team_id = \$1::bigint/);
    assert.match(s, /f\.scheduled_kickoff_at < \$2::timestamptz/);
    assert.doesNotMatch(s, /scheduled_kickoff_at <= /);
    assert.match(s, /f\.lifecycle_state_code = 'COMPLETED'/);
    assert.match(s, /JOIN football\.result r/);
    assert.match(s, /\$3::bigint IS NULL OR f\.competition_edition_id = \$3::bigint/);
    assert.match(s, /ORDER BY p\.full_name ASC, p\.id ASC, f\.scheduled_kickoff_at ASC, f\.id ASC/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(s));
  });

  test('stats SQL is bounded by team_id AND fixture id array (no other-team rows, no per-fixture loop)', () => {
    const s = TEAM_PLAYER_OBS_STATS_SQL;
    assert.match(s, /pms\.team_id = \$1::bigint AND pms\.fixture_id = ANY\(\$2::bigint\[\]\)/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(s));
  });
});

// ── read binding: two bounded queries, no N+1, no cross-team leak ─────────────

function captureTx(queue: unknown[][]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let i = 0;
  const tx = {
    query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: queue[i++] ?? [] }; },
  } as unknown as PoolClient;
  return { tx, calls };
}

describe('readTeamPlayerObservations — binding, no N+1, cross-team leak regression', () => {
  test('exactly two queries (fixtures + one bounded stats); both parameterized by team 72', async () => {
    const fixtures = [
      fixtureRow('1116', 'Vitor Roque', '1945', '2026-01-28T22:00:00Z'),
      fixtureRow('1116', 'Vitor Roque', '1926', '2026-02-26T00:30:00Z'),
    ];
    const stats = [stat('1116', '1945', 'goals', '1'), stat('1116', '1926', 'goals', '2'), stat('1116', '1926', 'minutesPlayed', '90')];
    const { tx, calls } = captureTx([fixtures, stats]);
    const res = await readTeamPlayerObservations(tx, TEAM, { asOf: new Date('2026-03-01T00:00:00Z'), editionId: null });

    assert.equal(calls.length, 2); // NO per-player / per-fixture N+1
    assert.equal(calls[0].params[0], '72'); // fixtures anchored on team 72
    assert.equal(calls[1].params[0], '72'); // stats scoped to team 72
    assert.deepEqual(calls[1].params[1], ['1945', '1926']); // one bounded id array
    assert.equal(res.playerCount, 1);
    assert.equal(res.players[0].player.id, '1116');
    assert.equal(res.players[0].observationCount, 2);
    assert.equal(res.players[0].latestObservation.fixtureId, '1926');
    assert.equal(res.players[0].summary.find((m) => m.key === 'goals')!.total, 3);
  });

  test('CROSS-TEAM LEAK REGRESSION: only the team-anchored fixtures reach the response', async () => {
    // The DB anchor (WHERE team_id = 72) means Q1 returns ONLY team-72 fixtures for the
    // player. Fixture 3 (team 91) is never selected, so it cannot enter team 72's index.
    const team72Fixtures = [
      fixtureRow('1116', 'Vitor Roque', '1', '2026-02-01T00:00:00Z'),
      fixtureRow('1116', 'Vitor Roque', '2', '2026-02-08T00:00:00Z'),
      // fixture '3' for team 91 is intentionally absent — the WHERE team_id=72 filter excludes it
    ];
    const { tx } = captureTx([team72Fixtures, [stat('1116', '1', 'goals', '1'), stat('1116', '2', 'goals', '0')]]);
    const res = await readTeamPlayerObservations(tx, TEAM, { asOf: new Date('2026-03-01T00:00:00Z'), editionId: null });
    const fixtureIds = res.players.flatMap((p) => [p.latestObservation.fixtureId]);
    assert.deepEqual(res.players[0].observationCount, 2);
    assert.ok(!fixtureIds.includes('3')); // no other-team fixture leaked
    assert.equal(res.players[0].summary.find((m) => m.key === 'goals')!.total, 1);
  });

  test('a governed team with no eligible observations → empty index, one query pair', async () => {
    const { tx, calls } = captureTx([[]]); // Q1 empty → Q2 skipped
    const res = await readTeamPlayerObservations(tx, TEAM, { asOf: new Date('2026-03-01T00:00:00Z'), editionId: null });
    assert.equal(res.playerCount, 0);
    assert.equal(calls.length, 1); // stats query skipped when there are no fixtures
  });
});
