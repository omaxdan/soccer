// TABLE CONTEXT read-model tests (DB-free, pure builders).
//
// Proves the two never-merged modes and their governance-locked shapes:
//   • CURRENT_PROVIDER — one coherent provider TOTAL table → full row, adjacent
//     above/below and point gaps from the SAME table; positionChange is null (a
//     snapshot carries no prior state); a missing team stays missing (table null,
//     never fabricated); top/bottom have one-sided adjacency.
//   • RAW_DETERMINISTIC — historical/as-of via Season Position Trajectory → the
//     team's latest-point position/totals + trajectory positionChange, with
//     adjacency and gaps NOT exposed (null); comparator/version carried through;
//     never called "official".
//   • no prediction/forecast/score/probability vocabulary leaks into the wire body.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCurrentTeam, buildCurrentTableContext,
  buildHistoricalTeam, buildHistoricalTableContext,
  type CurrentStandingsInput,
} from '../tableContext';
import type { EditionStandings, StandingLine } from '../editionStandings';
import type { SeasonPositionTrajectoryResponse, TeamTrajectory, TrajectoryPoint } from '../seasonPositionTrajectory';

// ── fixtures ──────────────────────────────────────────────────────────────────

const teamRef = (n: number) => ({ id: String(n), name: `Team ${n}`, slug: `team-${n}` });

const line = (position: number, teamNo: number, points: number, extra: Partial<StandingLine> = {}): StandingLine => ({
  position, team: teamRef(teamNo),
  played: 10, won: 3, drawn: 1, lost: 6,
  goalsFor: 12, goalsAgainst: 15, goalDifference: -3, points,
  ...extra,
});

// A coherent 4-row provider TOTAL table (descending points, provider-ordered).
const rows: StandingLine[] = [
  line(1, 10, 25, { won: 8, drawn: 1, lost: 1, goalsFor: 20, goalsAgainst: 6, goalDifference: 14 }),
  line(2, 20, 20, { won: 6, drawn: 2, lost: 2, goalsFor: 15, goalsAgainst: 9, goalDifference: 6 }),
  line(3, 30, 14, { won: 4, drawn: 2, lost: 4, goalsFor: 11, goalsAgainst: 12, goalDifference: -1 }),
  line(4, 40, 8, { won: 2, drawn: 2, lost: 6, goalsFor: 7, goalsAgainst: 18, goalDifference: -11 }),
];

const standingsInput = (theRows: StandingLine[]): CurrentStandingsInput => ({
  edition: { id: '42', seasonLabel: '2026', competition: { id: '1', name: 'League', slug: 'league' } },
  standings: {
    tables: theRows.length ? [{ variant: 'TOTAL', asOf: '2026-05-01T00:00:00.000Z', rows: theRows }] : [],
    coverage: { standings: theRows.length ? 'present' : 'absent', variantsPresent: theRows.length ? ['TOTAL'] : [], goalDifferenceIsDerived: true, standingsAreObservedSnapshots: true },
  } as unknown as EditionStandings,
});

const point = (seq: number, positionAfter: number, positionChange: number, table: TrajectoryPoint['table']): TrajectoryPoint => ({
  fixtureId: `f${seq}`, fixturePartitionOn: '2026-01-01', sequenceIndex: seq,
  kickoffAt: `2026-0${seq}-01T00:00:00.000Z`, opponent: teamRef(99), venueSide: 'home',
  result: 'W', pointsEarned: 3, positionBefore: positionAfter + positionChange, positionAfter, positionChange, table,
});

const trajTeam = (teamNo: number, points: TrajectoryPoint[]): TeamTrajectory => ({
  team: teamRef(teamNo),
  observationCount: points.length,
  trajectory: points,
  summary: {
    highestPosition: null, lowestPosition: null, currentPosition: points.length ? points[points.length - 1].positionAfter : null,
    averagePosition: null, medianPosition: null, positionMovesUp: 0, positionMovesDown: 0, positionUnchanged: 0,
    largestRise: 0, largestDrop: 0, longestUnchangedRun: 0,
  } as TeamTrajectory['summary'],
});

const trajectory = (teams: TeamTrajectory[]): SeasonPositionTrajectoryResponse => ({
  edition: { id: '42', seasonLabel: '2026' },
  competition: { id: '1', name: 'League', slug: 'league' },
  scope: { asOf: '2026-03-15T00:00:00.000Z', order: 'asc', teamId: null },
  asOf: '2026-03-15T00:00:00.000Z',
  mode: 'RAW_DETERMINISTIC',
  positionMethod: { comparator: ['points DESC', 'goalDifference DESC', 'goalsFor DESC', 'teamId ASC'], version: 'raw-det-1', note: 'x' } as SeasonPositionTrajectoryResponse['positionMethod'],
  teamCount: teams.length,
  teams,
});

// ── CURRENT_PROVIDER ────────────────────────────────────────────────────────

describe('Table Context · CURRENT_PROVIDER (coherent provider table)', () => {
  test('a mid-table team carries full row, both neighbours and point gaps; change is null', () => {
    const ctx = buildCurrentTeam(rows, 2); // Team 30, position 3
    assert.equal(ctx.team.id, '30');
    assert.deepEqual(ctx.table, { position: 3, played: 10, points: 14, wins: 4, draws: 2, losses: 4, goalsFor: 11, goalsAgainst: 12, goalDifference: -1 });
    assert.equal(ctx.change, null); // a snapshot has no prior state
    assert.equal(ctx.adjacent.above!.team.id, '20');
    assert.equal(ctx.adjacent.above!.pointsGap, 6); // 20 − 14
    assert.equal(ctx.adjacent.below!.team.id, '40');
    assert.equal(ctx.adjacent.below!.pointsGap, 6); // 14 − 8
    assert.ok(ctx.adjacent.above!.pointsGap >= 0 && ctx.adjacent.below!.pointsGap >= 0);
  });

  test('the leader has no team above; the bottom team has none below', () => {
    const top = buildCurrentTeam(rows, 0);
    assert.equal(top.adjacent.above, null);
    assert.equal(top.adjacent.below!.team.id, '20');
    const bottom = buildCurrentTeam(rows, rows.length - 1);
    assert.equal(bottom.adjacent.below, null);
    assert.equal(bottom.adjacent.above!.team.id, '30');
  });

  test('team-scoped response projects that team only; scope/mode/provenance are CURRENT', () => {
    const res = buildCurrentTableContext(standingsInput(rows), '20');
    assert.equal(res.scope.mode, 'CURRENT_PROVIDER');
    assert.equal(res.scope.asOf, null);
    assert.equal(res.team!.team.id, '20');
    assert.equal(res.team!.table!.position, 2);
    assert.equal(res.teams, null);
    assert.equal(res.method.mode, 'CURRENT_PROVIDER');
    assert.equal(res.provenance.source, 'editionStandings');
    assert.equal(res.provenance.standingsAsOf, '2026-05-01T00:00:00.000Z');
    assert.equal(res.edition.id, '42');
    assert.equal(res.competition.slug, 'league');
  });

  test('edition-wide response returns every team with its own adjacency; team is null', () => {
    const res = buildCurrentTableContext(standingsInput(rows), null);
    assert.equal(res.team, null);
    assert.equal(res.teams!.length, 4);
    assert.equal(res.teams![0].adjacent.above, null);
    assert.equal(res.teams![3].adjacent.below, null);
    assert.equal(res.teams![1].adjacent.above!.team.id, '10');
  });

  test('a requested team absent from the table stays missing — table/adjacency null, never fabricated', () => {
    const res = buildCurrentTableContext(standingsInput(rows), '777');
    assert.equal(res.team!.table, null);
    assert.equal(res.team!.change, null);
    assert.deepEqual(res.team!.adjacent, { above: null, below: null });
    assert.equal(res.team!.team.id, '777');
  });

  test('no TOTAL table → empty edition-wide teams; team-scoped request is missing', () => {
    const empty = buildCurrentTableContext(standingsInput([]), null);
    assert.deepEqual(empty.teams, []);
    assert.equal(empty.provenance.standingsAsOf, null);
    const scoped = buildCurrentTableContext(standingsInput([]), '10');
    assert.equal(scoped.team!.table, null);
  });
});

// ── RAW_DETERMINISTIC (historical / as-of) ──────────────────────────────────

describe('Table Context · RAW_DETERMINISTIC (historical, via trajectory)', () => {
  const teamState = { points: 17, wins: 5, draws: 2, losses: 3, goalsFor: 14, goalsAgainst: 10, goalDifference: 4 };
  const tt = trajTeam(30, [
    point(1, 6, 0, { points: 3, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 0, goalDifference: 2 }),
    point(2, 4, 2, teamState), // latest point: position 4, moved up 2
  ]);

  test('a team uses its latest trajectory point for position/totals + positionChange; adjacency NOT exposed', () => {
    const ctx = buildHistoricalTeam(tt);
    assert.equal(ctx.table!.position, 4);           // positionAfter of latest point
    assert.equal(ctx.table!.played, 10);            // wins+draws+losses = 5+2+3
    assert.equal(ctx.table!.points, 17);
    assert.equal(ctx.table!.goalDifference, 4);
    assert.deepEqual(ctx.change, { position: 2 });  // trajectory positionChange
    assert.deepEqual(ctx.adjacent, { above: null, below: null }); // never a synchronized as-of table
  });

  test('an empty trajectory yields table null and change null (no fabrication)', () => {
    const ctx = buildHistoricalTeam(trajTeam(50, []));
    assert.equal(ctx.table, null);
    assert.equal(ctx.change, null);
    assert.deepEqual(ctx.adjacent, { above: null, below: null });
  });

  test('team-scoped response carries comparator/version + lastEligibleFixtureId; mode RAW, asOf set', () => {
    const res = buildHistoricalTableContext(trajectory([tt]), '30', '2026-03-15T00:00:00.000Z');
    assert.equal(res.scope.mode, 'RAW_DETERMINISTIC');
    assert.equal(res.scope.asOf, '2026-03-15T00:00:00.000Z');
    assert.equal(res.team!.table!.position, 4);
    assert.equal(res.teams, null);
    assert.deepEqual(res.method.comparator, ['points DESC', 'goalDifference DESC', 'goalsFor DESC', 'teamId ASC']);
    assert.equal(res.method.version, 'raw-det-1');
    assert.equal(res.provenance.source, 'seasonPositionTrajectory');
    assert.equal(res.provenance.lastEligibleFixtureId, 'f2');
    assert.equal(res.provenance.reconstructionVersion, 'raw-det-1');
  });

  test('edition-wide RAW response returns per-team rows with adjacency null and no lastEligibleFixtureId', () => {
    const res = buildHistoricalTableContext(trajectory([tt, trajTeam(40, [point(1, 2, 0, teamState)])]), null, '2026-03-15T00:00:00.000Z');
    assert.equal(res.team, null);
    assert.equal(res.teams!.length, 2);
    assert.deepEqual(res.teams![0].adjacent, { above: null, below: null });
    assert.equal(res.provenance.lastEligibleFixtureId, null);
  });

  test('a requested team absent from the trajectory stays missing (table null)', () => {
    const res = buildHistoricalTableContext(trajectory([tt]), '888', '2026-03-15T00:00:00.000Z');
    assert.equal(res.team!.table, null);
    assert.equal(res.team!.team.id, '888');
  });

  test('the method note does NOT call RAW positions official', () => {
    const res = buildHistoricalTableContext(trajectory([tt]), '30', '2026-03-15T00:00:00.000Z');
    assert.ok(/not official/i.test(res.method.note));
  });
});

// ── vocabulary hygiene ──────────────────────────────────────────────────────

describe('Table Context · evidence-honest vocabulary', () => {
  test('neither mode leaks prediction / forecast / probability / score language', () => {
    const cur = JSON.stringify(buildCurrentTableContext(standingsInput(rows), null));
    const his = JSON.stringify(buildHistoricalTableContext(trajectory([trajTeam(30, [point(1, 4, 2, { points: 17, wins: 5, draws: 2, losses: 3, goalsFor: 14, goalsAgainst: 10, goalDifference: 4 })])]), null, '2026-03-15T00:00:00.000Z'));
    for (const body of [cur, his]) {
      assert.ok(!/predict|forecast|probab|\bodds\b|quality score|recommend/i.test(body), 'no prediction/recommendation vocabulary');
    }
  });
});
