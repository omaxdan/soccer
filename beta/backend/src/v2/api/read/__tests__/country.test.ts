// COUNTRY read-model tests (DB-free, pure).
//
// Proves the canonical-keystone projection:
//   • country identity maps from the vocabulary columns (code/display_name/alpha3);
//   • nullable alpha3Code stays null when the stored value is null — never fabricated;
//   • governance-vocabulary internals (meaning/effective_*) never leak into identity;
//   • competition rows map to the shared ApiCompetitionSummary;
//   • coverage: teams/competitions present when any, absent when none; country always
//     'present' (an unknown code is a 404, never an empty-collection 200);
//   • no ranking/readiness/performance/prediction/travel language leaks.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapCountry, mapCompetitionSummary, buildCountryCoverage,
  type CountryRow, type CountryCompetitionRow,
} from '../country';

describe('mapCountry', () => {
  test('maps code/display name/alpha3; vocabulary internals excluded', () => {
    const row: CountryRow = { code: 'BR', display_name: 'Brazil', alpha3_code: 'BRA' };
    assert.deepEqual(mapCountry(row), { code: 'BR', name: 'Brazil', alpha3Code: 'BRA' });
  });

  test('nullable alpha3Code stays null (never fabricated)', () => {
    const row: CountryRow = { code: 'XK', display_name: 'Kosovo', alpha3_code: null };
    const c = mapCountry(row);
    assert.equal(c.name, 'Kosovo');   // NOT NULL display name kept
    assert.equal(c.alpha3Code, null); // not '' , not inferred
  });
});

describe('mapCompetitionSummary', () => {
  test('maps a competition row to the shared summary (identity only)', () => {
    const row: CountryCompetitionRow = { id: '1', name: 'Brasileirão Série A', slug: 'brasileirao-serie-a' };
    assert.deepEqual(mapCompetitionSummary(row), { id: '1', name: 'Brasileirão Série A', slug: 'brasileirao-serie-a' });
  });
});

describe('buildCountryCoverage', () => {
  const team = { id: '68', name: 'Flamengo', slug: 'flamengo', shortName: null, countryCode: 'BR' };
  const comp = { id: '1', name: 'Série A', slug: 'serie-a' };

  test('present when any, absent when none; country always present', () => {
    assert.deepEqual(buildCountryCoverage([team], [comp]), { country: 'present', teams: 'present', competitions: 'present' });
    assert.deepEqual(buildCountryCoverage([], [comp]),     { country: 'present', teams: 'absent',  competitions: 'present' });
    assert.deepEqual(buildCountryCoverage([team], []),     { country: 'present', teams: 'present', competitions: 'absent' });
    assert.deepEqual(buildCountryCoverage([], []),         { country: 'present', teams: 'absent',  competitions: 'absent' });
  });
});

describe('governance', () => {
  test('projection carries no ranking/readiness/performance/prediction/travel language', () => {
    const blob = JSON.stringify({
      country: mapCountry({ code: 'BR', display_name: 'Brazil', alpha3_code: 'BRA' }),
      competitions: [mapCompetitionSummary({ id: '1', name: 'Série A', slug: 'serie-a' })],
      coverage: buildCountryCoverage([], []),
    }).toLowerCase();
    for (const term of ['ranking', 'rank', 'readiness', 'performance', 'predicted', 'probability', 'travel', 'distance', 'score', 'verdict', 'meaning', 'effective']) {
      assert.equal(blob.includes(term), false, `country must not emit "${term}"`);
    }
  });
});
