// MATCH VENUE read-model tests (DB-free, pure).
//
// Proves the evidence-honest venue projection:
//   • a complete venue maps all fields; numeric fields coerce from text
//   • nullable venue fields stay null (city/country/coords/elevation/capacity/surface)
//   • isNeutralVenue is preserved exactly from the fixture (true and false)
//   • a fixture with no recorded venue (venue_id null) → venue null, coverage 'absent'
//   • coverage flips present/absent correctly; venueIsObserved always true
//   • no intelligence fields (home-advantage/risk/etc.) are introduced

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { mapMatchVenue, type MatchVenueRow } from '../matchVenue';

function row(over: Partial<MatchVenueRow> = {}): MatchVenueRow {
  return {
    is_neutral_venue: false,
    venue_id: '500', name: 'Maracanã', city: 'Rio de Janeiro', country_code: 'BRA',
    latitude: '-22.912160', longitude: '-43.230180', elevation_metres: 9,
    timezone_name: 'America/Sao_Paulo', capacity: 78838, surface: 'grass',
    ...over,
  };
}

describe('mapMatchVenue — complete venue', () => {
  const out = mapMatchVenue(row());

  test('maps every field; coordinates/elevation/capacity coerced to numbers', () => {
    assert.deepEqual(out.venue, {
      id: '500', name: 'Maracanã', city: 'Rio de Janeiro', countryCode: 'BRA',
      latitude: -22.91216, longitude: -43.23018, elevationMetres: 9,
      timezoneName: 'America/Sao_Paulo', capacity: 78838, surface: 'grass',
    });
  });

  test('coverage present + observed flag; isNeutralVenue preserved (false)', () => {
    assert.equal(out.coverage.venue, 'present');
    assert.equal(out.coverage.venueIsObserved, true);
    assert.equal(out.isNeutralVenue, false);
  });
});

describe('mapMatchVenue — partial / neutral', () => {
  test('nullable venue fields stay null (never fabricated)', () => {
    const out = mapMatchVenue(row({ city: null, country_code: null, latitude: null, longitude: null, elevation_metres: null, timezone_name: null, capacity: null, surface: null }));
    assert.equal(out.venue!.name, 'Maracanã');   // NOT NULL stored name kept
    assert.equal(out.venue!.city, null);
    assert.equal(out.venue!.countryCode, null);
    assert.equal(out.venue!.latitude, null);
    assert.equal(out.venue!.longitude, null);
    assert.equal(out.venue!.elevationMetres, null);
    assert.equal(out.venue!.timezoneName, null);
    assert.equal(out.venue!.capacity, null);
    assert.equal(out.venue!.surface, null);
  });

  test('isNeutralVenue preserved exactly when true', () => {
    assert.equal(mapMatchVenue(row({ is_neutral_venue: true })).isNeutralVenue, true);
  });
});

describe('mapMatchVenue — absent venue', () => {
  test('venue_id null → venue null, coverage absent; isNeutralVenue still read from fixture', () => {
    const out = mapMatchVenue({
      is_neutral_venue: true, venue_id: null, name: null, city: null, country_code: null,
      latitude: null, longitude: null, elevation_metres: null, timezone_name: null, capacity: null, surface: null,
    });
    assert.equal(out.venue, null);
    assert.equal(out.coverage.venue, 'absent');
    assert.equal(out.coverage.venueIsObserved, true);
    assert.equal(out.isNeutralVenue, true);
  });
});

describe('governance', () => {
  test('projection carries no home-advantage/risk/prediction/travel language', () => {
    const blob = JSON.stringify(mapMatchVenue(row())).toLowerCase();
    for (const term of ['advantage', 'risk', 'predicted', 'probability', 'verdict', 'fatigue', 'travel', 'readiness']) {
      assert.equal(blob.includes(term), false, `venue must not emit "${term}"`);
    }
  });
});
