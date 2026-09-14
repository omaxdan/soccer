// EDITION STANDINGS read-model tests (DB-free, pure).
//
// Proves the evidence-honest league-table projection:
//   • a stored row maps to a line with goalDifference DERIVED (goalsFor − goalsAgainst),
//     including a real negative difference (never clamped)
//   • per variant, only the LATEST as-of snapshot is kept (temporal correctness);
//     a superseded older snapshot never leaks or merges
//   • rows are ordered by position; variants by a stable rank (TOTAL, HOME, AWAY, …)
//   • an edition with no standings yields an empty table set and coverage 'absent'
//     (never a fabricated placeholder table)
//   • coverage reports the variants actually present and flags goalDifference as
//     derived / standings as observed snapshots
//   • no governed-intelligence language (verdict/score/prediction) leaks

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapStandingLine, groupStandings, buildStandingsCoverage, assembleEditionStandings,
  type StandingRow,
} from '../editionStandings';

function row(over: Partial<StandingRow> & { standing_variant: string; as_of: string; position: number | string; team_id: string }): StandingRow {
  return {
    played: 10, won: 5, drawn: 3, lost: 2, goals_for: 15, goals_against: 9, points: 18,
    team_name: `Team ${over.team_id}`, team_slug: `team-${over.team_id}`,
    ...over,
  };
}

describe('mapStandingLine', () => {
  test('maps stored columns and derives goalDifference (exact, coerces text)', () => {
    const line = mapStandingLine(row({ standing_variant: 'TOTAL', as_of: '2026-07-01', position: '1', team_id: '67',
      played: '20', won: '13', drawn: '4', lost: '3', goals_for: '40', goals_against: '18', points: '43' }));
    assert.deepEqual(line, {
      position: 1, team: { id: '67', name: 'Team 67', slug: 'team-67' },
      played: 20, won: 13, drawn: 4, lost: 3, goalsFor: 40, goalsAgainst: 18,
      goalDifference: 22, points: 43,
    });
  });

  test('a negative goal difference is preserved, never clamped', () => {
    const line = mapStandingLine(row({ standing_variant: 'TOTAL', as_of: '2026-07-01', position: 18, team_id: '99', goals_for: 8, goals_against: 30 }));
    assert.equal(line.goalDifference, -22);
  });
});

describe('groupStandings — latest snapshot, ordered', () => {
  const rows: StandingRow[] = [
    // TOTAL, an OLD snapshot (must be dropped)
    row({ standing_variant: 'TOTAL', as_of: '2026-06-01', position: 1, team_id: '67', points: 30 }),
    row({ standing_variant: 'TOTAL', as_of: '2026-06-01', position: 2, team_id: '64', points: 28 }),
    // TOTAL, the LATEST snapshot (out of position order on purpose)
    row({ standing_variant: 'TOTAL', as_of: '2026-07-01', position: 2, team_id: '64', points: 40 }),
    row({ standing_variant: 'TOTAL', as_of: '2026-07-01', position: 1, team_id: '67', points: 43 }),
  ];
  const tables = groupStandings(rows);

  test('one table per variant, only the latest as-of snapshot retained', () => {
    assert.equal(tables.length, 1);
    assert.equal(tables[0].variant, 'TOTAL');
    assert.equal(tables[0].asOf, '2026-07-01');
    assert.equal(tables[0].rows.length, 2);
  });

  test('latest snapshot values win (superseded older snapshot does not leak)', () => {
    const top = tables[0].rows[0];
    assert.equal(top.team.id, '67');
    assert.equal(top.points, 43); // 43 from the latest, not 30 from the old snapshot
  });

  test('rows ordered by position ascending', () => {
    assert.deepEqual(tables[0].rows.map((r) => r.position), [1, 2]);
  });
});

describe('groupStandings — variant ordering & multi-variant', () => {
  const rows: StandingRow[] = [
    row({ standing_variant: 'AWAY', as_of: '2026-07-01', position: 1, team_id: '64' }),
    row({ standing_variant: 'TOTAL', as_of: '2026-07-01', position: 1, team_id: '67' }),
    row({ standing_variant: 'HOME', as_of: '2026-07-01', position: 1, team_id: '67' }),
  ];
  test('variants ordered TOTAL, HOME, AWAY regardless of input order', () => {
    assert.deepEqual(groupStandings(rows).map((t) => t.variant), ['TOTAL', 'HOME', 'AWAY']);
  });
});

describe('coverage & assembly', () => {
  test('empty standings → empty tables, coverage absent (no fabricated table)', () => {
    const out = assembleEditionStandings([]);
    assert.deepEqual(out.tables, []);
    assert.equal(out.coverage.standings, 'absent');
    assert.deepEqual(out.coverage.variantsPresent, []);
    assert.equal(out.coverage.goalDifferenceIsDerived, true);
    assert.equal(out.coverage.standingsAreObservedSnapshots, true);
  });

  test('present standings → coverage present with the variants actually stored', () => {
    const out = assembleEditionStandings([
      row({ standing_variant: 'TOTAL', as_of: '2026-07-01', position: 1, team_id: '67' }),
    ]);
    assert.equal(out.coverage.standings, 'present');
    assert.deepEqual(out.coverage.variantsPresent, ['TOTAL']);
  });

  test('buildStandingsCoverage reflects only the variants present (TOTAL-only is honest)', () => {
    const tables = groupStandings([row({ standing_variant: 'TOTAL', as_of: '2026-07-01', position: 1, team_id: '67' })]);
    const cov = buildStandingsCoverage(tables);
    assert.deepEqual(cov.variantsPresent, ['TOTAL']); // no fabricated HOME/AWAY
  });
});

describe('no governed intelligence leaks', () => {
  test('serialized projection contains no verdict/score/prediction language', () => {
    const out = assembleEditionStandings([
      row({ standing_variant: 'TOTAL', as_of: '2026-07-01', position: 1, team_id: '67' }),
    ]);
    const blob = JSON.stringify(out).toLowerCase();
    for (const term of ['verdict', 'confidence', 'readiness', 'preparedness', 'predicted', 'probability', 'odds']) {
      assert.equal(blob.includes(term), false, `standings must not emit "${term}"`);
    }
  });
});
