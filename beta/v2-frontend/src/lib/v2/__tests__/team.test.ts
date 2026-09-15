// TEAM helper tests (DB-free, pure). Presentation-only re-orientation of API values.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { lineGoals, lineResult, lineMatchFixture } from '../team';
import type { TeamFixtureLine } from '../types';

const base = (over: Partial<TeamFixtureLine>): TeamFixtureLine => ({
  fixtureId: '900', kickoffAt: '2026-08-01T20:00:00.000Z',
  competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' },
  opponent: { id: '67', name: 'Fluminense', slug: 'fluminense-1961' },
  isHome: true, status: 'COMPLETED', score: { home: 2, away: 0 }, ...over,
});

describe('lineGoals — GF/GA from the team perspective', () => {
  test('home: GF=home, GA=away', () => assert.deepEqual(lineGoals(base({})), { gf: 2, ga: 0 }));
  test('away: GF=away, GA=home', () => assert.deepEqual(lineGoals(base({ isHome: false, score: { home: 1, away: 3 } })), { gf: 3, ga: 1 }));
  test('no score → both null (never zero-filled)', () => assert.deepEqual(lineGoals(base({ score: null })), { gf: null, ga: null }));
});

describe('lineResult — W/D/L from the team perspective', () => {
  test('win', () => assert.equal(lineResult(base({})), 'W'));
  test('draw', () => assert.equal(lineResult(base({ score: { home: 1, away: 1 } })), 'D'));
  test('loss (away)', () => assert.equal(lineResult(base({ isHome: false, score: { home: 2, away: 0 } })), 'L'));
  test('no score → null', () => assert.equal(lineResult(base({ score: null })), null));
});

describe('lineMatchFixture — canonical home/away names for routes.match', () => {
  test('home fixture: team is home', () => {
    assert.deepEqual(lineMatchFixture(base({}), 'Flamengo'), { fixtureId: '900', homeTeam: { name: 'Flamengo' }, awayTeam: { name: 'Fluminense' } });
  });
  test('away fixture: team is away', () => {
    assert.deepEqual(lineMatchFixture(base({ isHome: false }), 'Flamengo'), { fixtureId: '900', homeTeam: { name: 'Fluminense' }, awayTeam: { name: 'Flamengo' } });
  });
});
