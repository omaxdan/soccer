// findTeamStanding tests (DB-free, pure). Matches by canonical team id — never first row.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { findTeamStanding } from '../standings';
import type { EditionStandings } from '../types';

const line = (position: number, id: string, name: string, points: number) => ({
  position, team: { id, name, slug: `${name.toLowerCase()}-${id}` },
  played: 25, won: 10, drawn: 5, lost: 10, goalsFor: 30, goalsAgainst: 30, goalDifference: 0, points,
});

const standings = (over: Partial<EditionStandings> = {}): EditionStandings => ({
  tables: [{
    variant: 'TOTAL', asOf: '2026-09-06',
    rows: [line(1, '68', 'Flamengo', 58), line(2, '67', 'Fluminense', 50), line(8, '59', 'Mirassol', 30)],
  }, {
    variant: 'HOME', asOf: '2026-09-06', rows: [line(1, '59', 'Mirassol', 40)], // decoy variant
  }],
  coverage: { standings: 'present', variantsPresent: ['TOTAL', 'HOME'], goalDifferenceIsDerived: true, standingsAreObservedSnapshots: true },
  ...over,
});

describe('findTeamStanding', () => {
  test('matches the correct team by id (NOT the first row), from the TOTAL table', () => {
    const row = findTeamStanding(standings(), '59');
    assert.equal(row?.position, 8);
    assert.equal(row?.team.name, 'Mirassol');
    assert.equal(row?.points, 30);
  });
  test('returns null when standings coverage is absent', () => {
    const empty = standings({ tables: [], coverage: { standings: 'absent', variantsPresent: [], goalDifferenceIsDerived: true, standingsAreObservedSnapshots: true } });
    assert.equal(findTeamStanding(empty, '68'), null);
  });
  test('returns null when the team has no row in the snapshot', () => {
    assert.equal(findTeamStanding(standings(), '999'), null);
  });
});
