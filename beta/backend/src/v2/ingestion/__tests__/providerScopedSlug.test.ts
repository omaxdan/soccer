// PROVIDER-SCOPED SLUG — collision safety at multi-competition scale (DB-free).
//
// Proves the slug-scalability fix: a name-only slug collides across countries
// (England/Russia/Egypt "Premier League"; Germany/Austria "Bundesliga";
// Scotland/South Africa "Premiership"), but providerScopedSlug folds the unique
// provider external id in, so genuinely different entities that share a name
// receive DISTINCT, deterministic slugs — without merging the entities.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { slugify, providerScopedSlug } from '../normalise';

describe('providerScopedSlug · collision safety', () => {
  test('same competition name in different countries → distinct slugs', () => {
    const eng = providerScopedSlug('Premier League', '17');
    const rus = providerScopedSlug('Premier League', '203');
    const egy = providerScopedSlug('Premier League', '808');
    assert.equal(eng, 'premier-league-17');
    assert.equal(rus, 'premier-league-203');
    assert.equal(egy, 'premier-league-808');
    assert.equal(new Set([eng, rus, egy]).size, 3, 'three same-named competitions → three distinct slugs');
  });

  test('Bundesliga (Germany/Austria) and Premiership (Scotland/South Africa) no longer collide', () => {
    assert.notEqual(providerScopedSlug('Bundesliga', '35'), providerScopedSlug('Bundesliga', '45'));
    assert.notEqual(providerScopedSlug('Premiership', '36'), providerScopedSlug('Premiership', '358'));
  });

  test('same team name in different countries → distinct slugs', () => {
    assert.notEqual(providerScopedSlug('Nacional', '1001'), providerScopedSlug('Nacional', '1002'));
  });

  test('deterministic — same name + id always yields the same slug', () => {
    assert.equal(providerScopedSlug('Stoiximan Super League', '185'), providerScopedSlug('Stoiximan Super League', '185'));
  });

  test('name base still folds diacritics (via slugify), id keeps distinct entities apart', () => {
    // Two clubs the provider spells differently but that fold to one base — a
    // shared base is fine BECAUSE the unique id disambiguates them.
    assert.equal(providerScopedSlug('Atlético Madrid', '20'), 'atletico-madrid-20');
    assert.equal(slugify('Bayern München'), slugify('Bayern Munchen'));
    assert.notEqual(providerScopedSlug('Bayern München', '35'), providerScopedSlug('Bayern München', '999'));
  });

  test('the slug is a label, not identity — it embeds the provider id but is not the canonical key', () => {
    // The id used here is the PROVIDER external id (known at write time), not the
    // internal DB id; canonical identity remains competition.id / team.id.
    assert.match(providerScopedSlug('La Liga', '8'), /^[a-z0-9-]+-8$/);
  });
});
