// SEASON POSITION TRAJECTORY — read-model tests (DB-free).
//
// Layers:
//   • Pure-logic: zero-point seating, chronological replay, comparator + tie-break,
//     before/after positions, position change, W/D/L/points/goals/GD, summary,
//     single-team filter, order/slice-after-reconstruction, integrity.
//   • SQL-shape: strict `< $2`, COMPLETED + result join, chronological order, NO LIMIT.
//   • tx-capture binding: 404, no-N+1 (identity + teams + fixtures).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  rankTeams, reconstructTrajectories, summarise, assembleSeasonPositionTrajectory,
  readSeasonPositionTrajectory, SeasonPositionTrajectoryDataIntegrityError,
  TRAJECTORY_FIXTURES_SQL, POSITION_COMPARATOR,
  type TrajectoryTeamRow, type TrajectoryFixtureRow,
} from '../seasonPositionTrajectory';

const IDENTITY = {
  edition: { id: '18', seasonLabel: 'Brasileiro Serie A 2026' },
  competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' },
};
const OPTS = { asOf: new Date('2026-09-20T00:00:00.000Z'), teamId: null, order: 'asc' as const, limit: null, offset: null };

const team = (id: string): TrajectoryTeamRow => ({ team_id: id, team_name: `Team ${id}`, team_slug: `team-${id}` });
const teams4 = [team('1'), team('2'), team('3'), team('4')];

const fx = (id: string, home: string, away: string, hg: number | null, ag: number | null, kickoff: string): TrajectoryFixtureRow =>
  ({ fixture_id: id, fixture_partition_on: kickoff.slice(0, 10), kickoff_at: kickoff, home_team_id: home, away_team_id: away, home_goals: hg, away_goals: ag });

describe('rankTeams — zero-point seating + comparator + teamId tie-break', () => {
  test('all-zero table ranks purely by teamId ASC', () => {
    const acc = new Map([['3', z()], ['1', z()], ['2', z()]]);
    const pos = rankTeams(acc);
    assert.equal(pos.get('1'), 1); assert.equal(pos.get('2'), 2); assert.equal(pos.get('3'), 3);
  });
  test('points → GD → GF → teamId ordering', () => {
    const acc = new Map([
      ['1', mk(3, 1, 0)],  // 3 pts, GD +1
      ['2', mk(3, 3, 1)],  // 3 pts, GD +2  → ahead of team 1
      ['3', mk(3, 2, 0)],  // 3 pts, GD +2, GF 2 → between
      ['4', mk(0, 0, 3)],  // 0 pts
    ]);
    const pos = rankTeams(acc);
    // 2 (GD+2,GF3), 3 (GD+2,GF2), 1 (GD+1), 4 (0pts)
    assert.deepEqual([pos.get('2'), pos.get('3'), pos.get('1'), pos.get('4')], [1, 2, 3, 4]);
  });
});
function z() { return { points: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 }; }
function mk(points: number, gf: number, ga: number) { return { points, wins: 0, draws: 0, losses: 0, gf, ga }; }

describe('reconstructTrajectories — chronological zero-point replay, before/after, orientation', () => {
  // fixture 1: team1 (H) 2-0 team2  → team1 win
  // fixture 2: team3 (H) 1-1 team4  → draw
  // fixture 3: team2 (H) 3-0 team1  → team2 win (away team1 loss)
  const fixtures = [
    fx('101', '1', '2', 2, 0, '2026-01-01T00:00:00Z'),
    fx('102', '3', '4', 1, 1, '2026-01-02T00:00:00Z'),
    fx('103', '2', '1', 3, 0, '2026-01-03T00:00:00Z'),
  ];
  const byTeam = reconstructTrajectories(teams4, fixtures);

  test('every participant seeded (4 teams), each fixture yields two points', () => {
    assert.equal(byTeam.size, 4);
    assert.equal(byTeam.get('1')!.length, 2); // played fixtures 101, 103
    assert.equal(byTeam.get('3')!.length, 1);
  });
  test('HOME orientation + result + points + table-after', () => {
    const p = byTeam.get('1')![0]; // fixture 101, team1 home
    assert.equal(p.venueSide, 'home'); assert.equal(p.opponent.id, '2');
    assert.equal(p.result, 'W'); assert.equal(p.pointsEarned, 3);
    assert.deepEqual({ gf: p.table.goalsFor, ga: p.table.goalsAgainst, gd: p.table.goalDifference, pts: p.table.points }, { gf: 2, ga: 0, gd: 2, pts: 3 });
  });
  test('AWAY orientation flips goals + result', () => {
    const p = byTeam.get('1')![1]; // fixture 103, team1 away, lost 0-3
    assert.equal(p.venueSide, 'away'); assert.equal(p.opponent.id, '2');
    assert.equal(p.result, 'L'); assert.equal(p.pointsEarned, 0);
    assert.equal(p.table.goalsFor, 2); assert.equal(p.table.goalsAgainst, 3); // cumulative: 2-0 then 0-3
  });
  test('positionBefore of team1 first fixture = zero-table teamId rank (1); positionAfter improves/holds', () => {
    const p = byTeam.get('1')![0];
    assert.equal(p.positionBefore, 1);        // all-zero table, teamId 1 → rank 1
    assert.equal(p.positionAfter, 1);          // after winning 2-0, still top
    assert.equal(p.positionChange, 0);         // 1 → 1
  });
  test('positionChange sign: moving toward rank 1 is positive', () => {
    // team2 wins fixture 103 from behind; compute its change on that fixture
    const p = byTeam.get('2')!.find((x) => x.fixtureId === '103')!;
    assert.equal(p.positionChange, p.positionBefore - p.positionAfter);
    assert.ok(p.positionAfter <= p.positionBefore); // a win never drops you
  });
});

describe('summarise — aggregates over the full series', () => {
  test('highest/lowest/current/moves/runs', () => {
    const fixtures = [
      fx('1', '1', '2', 0, 1, '2026-01-01T00:00:00Z'), // team1 loses → drops
      fx('2', '1', '3', 3, 0, '2026-01-02T00:00:00Z'), // team1 wins → rises
      fx('3', '1', '4', 0, 0, '2026-01-03T00:00:00Z'), // team1 draws
    ];
    const byTeam = reconstructTrajectories(teams4, fixtures);
    const s = summarise(byTeam.get('1')!);
    assert.equal(s.totalObservedFixtures, 3);
    assert.equal(s.currentPosition, byTeam.get('1')![2].positionAfter);
    assert.ok(s.highestPosition! <= s.lowestPosition!);
    assert.equal(s.positionMovesUp + s.positionMovesDown + s.positionUnchanged, 3);
    assert.ok(s.largestRise >= 0); assert.ok(s.largestDrop <= 0);
    assert.ok(s.longestUnchangedRun >= 1);
  });
  test('empty series → nulls and zeros', () => {
    const s = summarise([]);
    assert.equal(s.totalObservedFixtures, 0);
    assert.equal(s.currentPosition, null);
    assert.equal(s.highestPosition, null);
    assert.equal(s.largestRise, 0);
  });
});

describe('same-kickoff determinism — fixtureId tie-break in the fixtures SQL order (applied by DB); replay is order-faithful', () => {
  test('two fixtures at same kickoff replay in given (id) order deterministically', () => {
    const fixtures = [
      fx('201', '1', '2', 1, 0, '2026-02-01T12:00:00Z'),
      fx('202', '3', '4', 2, 0, '2026-02-01T12:00:00Z'),
    ];
    const a = reconstructTrajectories(teams4, fixtures);
    const b = reconstructTrajectories(teams4, fixtures);
    assert.deepEqual(a.get('1')!.map((p) => p.positionAfter), b.get('1')!.map((p) => p.positionAfter));
  });
});

describe('assemble — team filter, order, slice-after-reconstruction', () => {
  const fixtures = [
    fx('1', '1', '2', 1, 0, '2026-01-01T00:00:00Z'),
    fx('2', '1', '3', 2, 0, '2026-01-02T00:00:00Z'),
    fx('3', '1', '4', 0, 1, '2026-01-03T00:00:00Z'),
  ];
  const byTeam = reconstructTrajectories(teams4, fixtures);
  test('team filter returns only that team; mode + positionMethod present', () => {
    const res = assembleSeasonPositionTrajectory(IDENTITY, teams4, byTeam, { ...OPTS, teamId: '1' });
    assert.equal(res.teamCount, 1);
    assert.equal(res.teams[0].team.id, '1');
    assert.equal(res.mode, 'RAW_DETERMINISTIC');
    assert.deepEqual(res.positionMethod.comparator, [...POSITION_COMPARATOR]);
  });
  test('order=desc + limit=2 emits last-two chronological points; sequenceIndex preserved; summary from full', () => {
    const res = assembleSeasonPositionTrajectory(IDENTITY, teams4, byTeam, { ...OPTS, teamId: '1', order: 'desc', limit: 2 });
    const traj = res.teams[0].trajectory;
    assert.deepEqual(traj.map((p) => p.sequenceIndex), [3, 2]); // canonical indices, reversed order
    assert.equal(res.teams[0].observationCount, 3);             // full count
    assert.equal(res.teams[0].summary.totalObservedFixtures, 3); // summary from full series
    assert.equal(res.teams[0].summary.currentPosition, byTeam.get('1')![2].positionAfter); // final chronological
  });
  test('offset after reconstruction does not corrupt cumulative table', () => {
    const res = assembleSeasonPositionTrajectory(IDENTITY, teams4, byTeam, { ...OPTS, teamId: '1', order: 'asc', offset: 1 });
    const traj = res.teams[0].trajectory;
    assert.deepEqual(traj.map((p) => p.sequenceIndex), [2, 3]);
    assert.equal(traj[0].table.points, 6); // fixture 2 cumulative (W,W), not recomputed from offset
  });
  test('all teams returned when no team filter; ordered by current position then teamId', () => {
    const res = assembleSeasonPositionTrajectory(IDENTITY, teams4, byTeam, OPTS);
    assert.equal(res.teamCount, 4);
    const positions = res.teams.map((t) => t.summary.currentPosition);
    for (let i = 1; i < positions.length; i++) assert.ok((positions[i - 1] ?? 99) <= (positions[i] ?? 99));
  });
});

describe('data integrity — missing goals on an eligible fixture throws', () => {
  test('null home_goals → integrity error (never fabricated as zero)', () => {
    const fixtures = [fx('1', '1', '2', null, 0, '2026-01-01T00:00:00Z')];
    assert.throws(() => reconstructTrajectories(teams4, fixtures), SeasonPositionTrajectoryDataIntegrityError);
  });
  test('non-numeric away_goals → integrity error', () => {
    const bad = { ...fx('1', '1', '2', 1, 0, '2026-01-01T00:00:00Z'), away_goals: 'x' } as TrajectoryFixtureRow;
    assert.throws(() => reconstructTrajectories(teams4, [bad]), SeasonPositionTrajectoryDataIntegrityError);
  });
});

// ── SQL shape ─────────────────────────────────────────────────────────────────
describe('SQL shape', () => {
  test('fixtures SQL: strict `< $2`, COMPLETED, result join, chronological order, NO LIMIT, read-only', () => {
    const s = TRAJECTORY_FIXTURES_SQL;
    assert.match(s, /f\.scheduled_kickoff_at < \$2::timestamptz/);
    assert.doesNotMatch(s, /scheduled_kickoff_at <= /);
    assert.match(s, /f\.lifecycle_state_code = 'COMPLETED'/);
    assert.match(s, /JOIN football\.result r\s+ON r\.fixture_id = f\.id AND r\.fixture_partition_on = f\.fixture_partition_on/);
    assert.match(s, /ORDER BY f\.scheduled_kickoff_at ASC, f\.id ASC/);
    assert.doesNotMatch(s, /\bLIMIT\b/i);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(s));
  });
});

// ── read binding (capture tx) ────────────────────────────────────────────────
function captureTx(queue: unknown[][]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let i = 0;
  const tx = {
    query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: queue[i++] ?? [] }; },
  } as unknown as PoolClient;
  return { tx, calls };
}
const idRow = { edition_id: '18', season_label: 'Brasileiro Serie A 2026', competition_id: '28', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano-325' };

describe('readSeasonPositionTrajectory — binding + 404 + no N+1', () => {
  test('unknown edition → null (404), only identity query runs', async () => {
    const { tx, calls } = captureTx([[]]);
    const res = await readSeasonPositionTrajectory(tx, '999');
    assert.equal(res, null);
    assert.equal(calls.length, 1);
  });
  test('known edition → identity + teams + fixtures (exactly three; no per-fixture/per-team N+1)', async () => {
    const { tx, calls } = captureTx([
      [idRow],
      [team('1'), team('2')],
      [fx('1', '1', '2', 1, 0, '2026-01-01T00:00:00Z')],
    ]);
    const res = await readSeasonPositionTrajectory(tx, '18', { asOf: new Date('2026-09-20T00:00:00Z') });
    assert.ok(res);
    assert.equal(calls.length, 3);
    assert.equal(calls[2].params[0], '18');            // fixtures scoped to edition
    assert.ok(calls[2].params[1] instanceof Date);     // strict asOf bound
    assert.equal(res!.teamCount, 2);
  });
  test('strict asOf: a fixture exactly at asOf is excluded by the DB predicate (verified via SQL shape), earlier included', async () => {
    // binding-level: the read passes asOf through as $2; strictness is enforced by `< $2` in SQL.
    const { tx, calls } = captureTx([[idRow], [team('1'), team('2')], []]);
    await readSeasonPositionTrajectory(tx, '18', { asOf: new Date('2026-06-01T00:00:00Z') });
    assert.equal((calls[2].params[1] as Date).toISOString(), '2026-06-01T00:00:00.000Z');
  });
});
