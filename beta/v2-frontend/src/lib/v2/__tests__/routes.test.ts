// V2 ROUTE HELPER TESTS (DB-free, pure).
//
// Guards the namespace discipline that makes the eventual root-domain cutover a
// one-line change: every internal link is built from V2_BASE, no link ever contains
// /pitch, match links preserve the canonical slug/id round-trip, and flipping the
// base to '' flattens every path (/v2/matches/x -> /matches/x).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { routes, v2Path, v2EditionSlug, V2_BASE } from '../routes';
import { idFromParam } from '../slug';

const FIXTURE = {
  fixtureId: '1384',
  kickoffAt: '2026-09-13T12:30:00.000Z',
  status: 'SCHEDULED',
  homeTeam: { id: '599', name: 'Flamengo', slug: 'flamengo-599' },
  awayTeam: { id: '602', name: 'Botafogo', slug: 'botafogo-602' },
  score: null,
};

describe('v2Path — the single namespace join', () => {
  test('prefixes under the current /v2 base', () => {
    assert.equal(v2Path('/v2', '/matches/x'), '/v2/matches/x');
    assert.equal(v2Path('/v2', '/'), '/v2');          // index collapses to the bare base
    assert.equal(v2Path('/v2', '/teams'), '/v2/teams');
  });
  test('flattens cleanly when the base becomes empty (root-domain cutover)', () => {
    assert.equal(v2Path('', '/matches/x'), '/matches/x');
    assert.equal(v2Path('', '/'), '/');               // leagues index -> root
    assert.equal(v2Path('', '/teams'), '/teams');
  });
  test('tolerates a trailing slash on the base', () => {
    assert.equal(v2Path('/v2/', '/teams'), '/v2/teams');
  });
});

describe('routes — internal consistency + no /pitch', () => {
  const all = [
    routes.leagues(),
    routes.edition('88'),
    routes.match(FIXTURE),
    routes.matchBySlug('flamengo-vs-botafogo-1384'),
    routes.teams(),
    routes.team({ id: '68', slug: 'flamengo-5981' }),
    routes.players(),
    routes.player({ id: '7', slug: 'ada-hegerberg-441' }),
    routes.competition({ id: '28', slug: 'brasileirao-betano-325' }),
    routes.venue({ id: '25', name: 'Estádio do Maracanã' }),
    routes.country({ code: 'BR' }),
  ];
  test('every route begins with the current base and never contains /pitch', () => {
    for (const href of all) {
      assert.equal(href.startsWith(V2_BASE), true, `${href} must start with ${V2_BASE}`);
      assert.equal(href.includes('/pitch'), false, `${href} must not contain /pitch`);
    }
  });
  test('routes resolve to the expected shapes', () => {
    assert.equal(routes.leagues(), '/v2');
    assert.equal(routes.edition('88'), '/v2/editions/88');
    assert.equal(routes.teams(), '/v2/teams');
    assert.equal(routes.players(), '/v2/players');
    // Human part is the CANONICAL STORED slug (not slugify(name)); DB id is the trailing resolver.
    assert.equal(routes.team({ id: '68', slug: 'flamengo-5981' }), '/v2/teams/flamengo-5981-68');
    assert.equal(routes.player({ id: '7', slug: 'ada-hegerberg-441' }), '/v2/players/ada-hegerberg-441-7');
  });
});

describe('canonical-slug reconciliation — stored slug + DB id (id is the resolver)', () => {
  test('competition uses competition.slug + id', () => {
    assert.equal(routes.competition({ id: '28', slug: 'brasileirao-betano-325' }), '/v2/competitions/brasileirao-betano-325-28');
    assert.equal(idFromParam('brasileirao-betano-325-28'), 28); // API receives the id
  });
  test('team uses team.slug + id', () => {
    assert.equal(routes.team({ id: '68', slug: 'flamengo-5981' }), '/v2/teams/flamengo-5981-68');
    assert.equal(idFromParam('flamengo-5981-68'), 68);
  });
  test('player uses player.slug + id', () => {
    assert.equal(routes.player({ id: '7', slug: 'ada-hegerberg-441' }), '/v2/players/ada-hegerberg-441-7');
    assert.equal(idFromParam('ada-hegerberg-441-7'), 7);
  });
  test('edition retains the established {competition}-{season}-{id} hybrid (unchanged)', () => {
    assert.equal(routes.edition({ id: '18', competition: { slug: 'brasileirao-betano-325' }, seasonLabel: '2026' }), '/v2/editions/brasileirao-betano-325-2026-18');
    assert.equal(idFromParam('brasileirao-betano-325-2026-18'), 18);
  });
  test('venue has no stored slug → slugify(name)-id (unchanged)', () => {
    assert.equal(routes.venue({ id: '25', name: 'Estádio do Maracanã' }), '/v2/venues/estadio-do-maracana-25');
    assert.equal(idFromParam('estadio-do-maracana-25'), 25);
  });
  test('country is addressed by its ISO alpha-2 code (no trailing id)', () => {
    assert.equal(routes.country({ code: 'BR' }), '/v2/countries/BR');
  });

  test('CRITICAL: changing the human-readable portion does not change which id resolves', () => {
    // Same DB id (68), different (even wrong) human parts — all resolve to 68.
    assert.equal(idFromParam('flamengo-5981-68'), 68);
    assert.equal(idFromParam('flamengo-68'), 68);
    assert.equal(idFromParam('completely-different-name-68'), 68);
    assert.equal(idFromParam('68'), 68);                 // bare id still resolves (back-compat)
    // A different trailing id is a different entity — the human part is never consulted.
    assert.notEqual(idFromParam('flamengo-5981-99'), 68);
  });
});

describe('edition slug-id routing (readable URL, numeric id authoritative)', () => {
  const ref = { id: '18', competition: { slug: 'premier-league' }, seasonLabel: '2026' };
  test('v2EditionSlug builds {competition}-{season}-{id}', () => {
    assert.equal(v2EditionSlug(ref), 'premier-league-2026-18');
    assert.equal(v2EditionSlug({ id: '42', competition: { slug: 'champions-league' }, seasonLabel: '2025/26' }), 'champions-league-2025-26-42');
  });
  test('routes.edition accepts a ref (readable slug) or a bare id (back-compatible)', () => {
    assert.equal(routes.edition(ref), '/v2/editions/premier-league-2026-18');
    assert.equal(routes.edition('18'), '/v2/editions/18'); // bare id still works
    assert.equal(routes.edition(ref).includes('/pitch'), false);
  });
  test('the numeric edition id round-trips out of the readable slug (API gets the id)', () => {
    const href = routes.edition(ref);
    const slug = href.slice(href.lastIndexOf('/') + 1);
    assert.equal(slug, 'premier-league-2026-18');
    assert.equal(idFromParam(slug), 18);                     // what the page parses → API
    assert.equal(idFromParam('champions-league-2025-26-42'), 42);
  });
});

describe('match links preserve slug/id behavior', () => {
  test('routes.match builds the canonical {home}-vs-{away}-{id} slug', () => {
    assert.equal(routes.match(FIXTURE), '/v2/matches/flamengo-vs-botafogo-1384');
  });
  test('the fixture id round-trips out of the generated match URL', () => {
    const href = routes.match(FIXTURE);
    const slug = href.slice(href.lastIndexOf('/') + 1);
    assert.equal(idFromParam(slug), 1384);
  });
});
