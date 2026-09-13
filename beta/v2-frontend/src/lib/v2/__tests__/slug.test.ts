// V2 public match-route slug helpers (DB-free, pure).
//
// Proves the canonical slug-id convention for V2 match routes: the slug shape
// `{home}-vs-{away}-{id}`, extraction of the trailing numeric fixture id, honest
// rejection of a slug with no numeric id, and the round trip. Run with:
//   npx tsx --test src/lib/v2/__tests__/slug.test.ts

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { v2MatchSlug, idFromParam } from '../slug';

describe('v2 match slug · idFromParam', () => {
  test('extracts the trailing numeric fixture id from a canonical slug', () => {
    assert.equal(idFromParam('flamengo-vs-botafogo-338'), 338);
  });

  test('a slug with no numeric suffix yields null (route must 404, never guess)', () => {
    assert.equal(idFromParam('flamengo-vs-botafogo'), null);
    assert.equal(idFromParam('not-a-match'), null);
  });

  test('a bare numeric id is still resolvable', () => {
    assert.equal(idFromParam('338'), 338);
  });
});

describe('v2 match slug · v2MatchSlug', () => {
  const fixture = { fixtureId: '338', homeTeam: { name: 'Flamengo' }, awayTeam: { name: 'Botafogo' } };

  test('produces the canonical {home}-vs-{away}-{id} shape', () => {
    assert.equal(v2MatchSlug(fixture), 'flamengo-vs-botafogo-338');
  });

  test('reuses the repository slugify (diacritics folded, lowercased)', () => {
    assert.equal(
      v2MatchSlug({ fixtureId: '12', homeTeam: { name: 'Atlético Madrid' }, awayTeam: { name: 'Bayern München' } }),
      'atletico-madrid-vs-bayern-munchen-12'
    );
  });

  test('round-trips: idFromParam(v2MatchSlug(f)) recovers the fixture id', () => {
    assert.equal(idFromParam(v2MatchSlug(fixture)), Number(fixture.fixtureId));
  });
});
