// COMPETITION read-model tests (DB-free, pure).
//
// Proves the canonical-keystone projection:
//   • competition identity maps from stored columns (id/name/slug/country_code);
//   • nullable countryCode stays null when the stored value is null — never fabricated;
//   • edition rows map to the SHARED ApiEditionSummary (no second edition shape);
//     fixture_count coerces to a number;
//   • coverage: editions present when any, absent when none; competition always
//     'present' (an unknown/unauthorized competition is a 404, never an empty 200);
//   • no standings/ranking/readiness/performance/prediction language leaks.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapCompetition, mapCompetitionEdition, buildCompetitionCoverage,
  type CompetitionRow, type CompetitionEditionRow,
} from '../competition';

describe('mapCompetition', () => {
  test('maps id/name/slug/countryCode', () => {
    const row: CompetitionRow = { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325', country_code: 'BR' };
    assert.deepEqual(mapCompetition(row), { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325', countryCode: 'BR' });
  });

  test('nullable countryCode stays null (never fabricated)', () => {
    const c = mapCompetition({ id: '9', name: 'World Cup', slug: 'world-cup', country_code: null });
    assert.equal(c.name, 'World Cup');
    assert.equal(c.countryCode, null); // e.g. an international competition with no single country
  });
});

describe('mapCompetitionEdition', () => {
  test('maps an edition row to the shared ApiEditionSummary; fixture_count coerced', () => {
    const row: CompetitionEditionRow = {
      edition_id: '42', season_label: '2025',
      competition_id: '28', competition_name: 'Brasileirão Betano', competition_slug: 'brasileirao-betano-325',
      fixture_count: '380',
    };
    assert.deepEqual(mapCompetitionEdition(row), {
      id: '42', seasonLabel: '2025',
      competition: { id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325' },
      fixtureCount: 380,
    });
  });

  test('zero fixtures are preserved as 0 (governed edition with no materialized fixtures)', () => {
    const e = mapCompetitionEdition({ edition_id: '43', season_label: '2026', competition_id: '28', competition_name: 'X', competition_slug: 'x', fixture_count: 0 });
    assert.equal(e.fixtureCount, 0);
  });
});

describe('buildCompetitionCoverage', () => {
  const edition = { id: '42', seasonLabel: '2025', competition: { id: '28', name: 'X', slug: 'x' }, fixtureCount: 380 };

  test('editions present when any, absent when none; competition always present', () => {
    assert.deepEqual(buildCompetitionCoverage([edition]), { competition: 'present', editions: 'present' });
    assert.deepEqual(buildCompetitionCoverage([]),        { competition: 'present', editions: 'absent' });
  });
});

describe('governance', () => {
  test('projection carries no standings/ranking/readiness/performance/prediction language', () => {
    const blob = JSON.stringify({
      competition: mapCompetition({ id: '28', name: 'Brasileirão Betano', slug: 'brasileirao-betano-325', country_code: 'BR' }),
      editions: [mapCompetitionEdition({ edition_id: '42', season_label: '2025', competition_id: '28', competition_name: 'X', competition_slug: 'x', fixture_count: 380 })],
      coverage: buildCompetitionCoverage([]),
    }).toLowerCase();
    for (const term of ['standing', 'ranking', 'rank', 'readiness', 'performance', 'predicted', 'probability', 'verdict', 'score', 'travel']) {
      assert.equal(blob.includes(term), false, `competition must not emit "${term}"`);
    }
  });
});
