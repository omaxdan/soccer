// V2 public match-route slug helpers (DB-free, pure).
//
// Proves the canonical slug-id convention for V2 match routes: the slug shape
// `{home}-vs-{away}-{id}`, extraction of the trailing numeric fixture id, honest
// rejection of a slug with no numeric id, and the round trip. Run with:
//   npx tsx --test src/lib/v2/__tests__/slug.test.ts

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { v2MatchSlug, v2TeamSlug, v2PlayerSlug, v2CompetitionSlug, v2VenueSlug, idFromParam } from '../slug';

describe('v2 match slug · idFromParam', () => {
  test('extracts the trailing numeric fixture id from a canonical slug', () => {
    assert.equal(idFromParam('flamengo-vs-botafogo-338'), 338);
    assert.equal(idFromParam('foo-28'), 28);
  });

  test('a slug with no numeric suffix yields null (route must 404, never guess)', () => {
    assert.equal(idFromParam('flamengo-vs-botafogo'), null);
    assert.equal(idFromParam('not-a-match'), null);
  });

  test('a bare numeric id is still resolvable', () => {
    assert.equal(idFromParam('338'), 338);
    assert.equal(idFromParam('28'), 28);
  });
});

describe('entity slug helpers · canonical stored slug + DB id', () => {
  test('v2TeamSlug / v2PlayerSlug / v2CompetitionSlug use the STORED slug (not slugify(name)) + id', () => {
    assert.equal(v2TeamSlug({ id: '68', slug: 'flamengo-5981' }), 'flamengo-5981-68');
    assert.equal(v2PlayerSlug({ id: '7', slug: 'ada-hegerberg-441' }), 'ada-hegerberg-441-7');
    assert.equal(v2CompetitionSlug({ id: '28', slug: 'brasileirao-betano-325' }), 'brasileirao-betano-325-28');
  });
  test('v2VenueSlug slugifies the name (no stored slug) + mandatory id', () => {
    assert.equal(v2VenueSlug({ id: '25', name: 'Estádio do Maracanã' }), 'estadio-do-maracana-25');
  });
  test('each entity slug round-trips to its DB id via idFromParam', () => {
    assert.equal(idFromParam(v2TeamSlug({ id: '68', slug: 'flamengo-5981' })), 68);
    assert.equal(idFromParam(v2PlayerSlug({ id: '7', slug: 'ada-hegerberg-441' })), 7);
    assert.equal(idFromParam(v2CompetitionSlug({ id: '28', slug: 'brasileirao-betano-325' })), 28);
    assert.equal(idFromParam(v2VenueSlug({ id: '25', name: 'Estádio do Maracanã' })), 25);
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
