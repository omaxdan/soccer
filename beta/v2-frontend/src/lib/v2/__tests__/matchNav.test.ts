// MATCH NAVIGATION TESTS (DB-free, pure).
//
// Prev/next derivation within a competition edition: chronological ordering, correct
// neighbours, honest ends (null), and no fabrication when the current fixture is not
// in the edition list.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { orderByKickoff, findAdjacentFixtures } from '../matchNav';
import type { ApiEditionFixture } from '../types';

function fx(id: string, kickoffAt: string): ApiEditionFixture {
  return {
    fixtureId: id, kickoffAt, status: 'SCHEDULED',
    homeTeam: { id: `h${id}`, name: `Home ${id}`, slug: `home-${id}` },
    awayTeam: { id: `a${id}`, name: `Away ${id}`, slug: `away-${id}` },
    score: null,
  };
}

// Deliberately out of order to prove the helper sorts by kickoff.
const FIXTURES = [
  fx('30', '2026-09-20T18:00:00.000Z'),
  fx('10', '2026-09-06T15:00:00.000Z'),
  fx('20', '2026-09-13T12:30:00.000Z'),
];

describe('orderByKickoff', () => {
  test('sorts ascending by kickoff without mutating the input', () => {
    const before = FIXTURES.map((f) => f.fixtureId);
    const ordered = orderByKickoff(FIXTURES).map((f) => f.fixtureId);
    assert.deepEqual(ordered, ['10', '20', '30']);
    assert.deepEqual(FIXTURES.map((f) => f.fixtureId), before); // unmutated
  });
});

describe('findAdjacentFixtures', () => {
  test('middle fixture has both prev and next', () => {
    const { prev, next } = findAdjacentFixtures(FIXTURES, '20');
    assert.equal(prev?.fixtureId, '10');
    assert.equal(next?.fixtureId, '30');
  });
  test('first fixture has no prev', () => {
    const { prev, next } = findAdjacentFixtures(FIXTURES, '10');
    assert.equal(prev, null);
    assert.equal(next?.fixtureId, '20');
  });
  test('last fixture has no next', () => {
    const { prev, next } = findAdjacentFixtures(FIXTURES, '30');
    assert.equal(prev?.fixtureId, '20');
    assert.equal(next, null);
  });
  test('absent fixture yields no neighbours (never fabricates)', () => {
    const { prev, next } = findAdjacentFixtures(FIXTURES, '999');
    assert.equal(prev, null);
    assert.equal(next, null);
  });
  test('single-fixture edition has neither neighbour', () => {
    const { prev, next } = findAdjacentFixtures([fx('1', '2026-09-01T00:00:00.000Z')], '1');
    assert.equal(prev, null);
    assert.equal(next, null);
  });
});
