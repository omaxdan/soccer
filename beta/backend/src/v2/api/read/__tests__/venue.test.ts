// VENUE read-model tests (DB-free, pure).
//
// Proves the geospatial-keystone projection:
//   • venue identity + geography map from stored columns; coordinates/elevation/
//     capacity coerce to numbers;
//   • every nullable geographic field stays null when the stored value is null —
//     never fabricated, inferred, or zero-filled;
//   • home teams map to the shared ApiTeamSummary (canonical relationship);
//   • coverage: homeTeams present/absent; venue always 'present' (404 otherwise);
//   • no travel/impact/prediction/probability fields leak (map = evidence only).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapVenue, mapVenueTeam, buildVenueCoverage,
  type VenueRow, type VenueTeamRow,
} from '../venue';

function vrow(over: Partial<VenueRow> = {}): VenueRow {
  return {
    id: '25', name: 'Maracanã', city: 'Rio de Janeiro', country_code: 'BR',
    latitude: '-22.912160', longitude: '-43.230180', elevation_metres: 9,
    timezone_name: 'America/Sao_Paulo', capacity: 78838, surface: 'grass',
    ...over,
  };
}

describe('mapVenue', () => {
  test('maps identity + geography; coordinates/elevation/capacity coerced to numbers', () => {
    assert.deepEqual(mapVenue(vrow()), {
      id: '25', name: 'Maracanã', city: 'Rio de Janeiro', countryCode: 'BR',
      latitude: -22.91216, longitude: -43.23018, elevationMetres: 9,
      timezoneName: 'America/Sao_Paulo', capacity: 78838, surface: 'grass',
    });
  });

  test('nullable geographic fields stay null (never fabricated/inferred/zero-filled)', () => {
    const v = mapVenue(vrow({ city: null, country_code: null, latitude: null, longitude: null, elevation_metres: null, timezone_name: null, capacity: null, surface: null }));
    assert.equal(v.name, 'Maracanã');   // NOT NULL name kept
    assert.equal(v.city, null);
    assert.equal(v.countryCode, null);
    assert.equal(v.latitude, null);      // not 0
    assert.equal(v.longitude, null);
    assert.equal(v.elevationMetres, null);
    assert.equal(v.timezoneName, null);
    assert.equal(v.capacity, null);
    assert.equal(v.surface, null);
  });
});

describe('mapVenueTeam', () => {
  test('maps a home team to the shared team summary', () => {
    const row: VenueTeamRow = { id: '67', name: 'Fluminense', slug: 'fluminense', short_name: 'FLU', country_code: 'BR' };
    assert.deepEqual(mapVenueTeam(row), { id: '67', name: 'Fluminense', slug: 'fluminense', shortName: 'FLU', countryCode: 'BR' });
  });
  test('nullable short_name/country stay null', () => {
    const t = mapVenueTeam({ id: '9', name: 'X', slug: 'x', short_name: null, country_code: null });
    assert.equal(t.shortName, null);
    assert.equal(t.countryCode, null);
  });
});

describe('buildVenueCoverage', () => {
  test('homeTeams present when any, absent when none; venue always present', () => {
    const present = buildVenueCoverage([{ id: '67', name: 'Fluminense', slug: 'fluminense', shortName: null, countryCode: null }]);
    assert.deepEqual(present, { venue: 'present', homeTeams: 'present' });
    assert.deepEqual(buildVenueCoverage([]), { venue: 'present', homeTeams: 'absent' });
  });
});

describe('governance', () => {
  test('projection carries no travel/impact/prediction/probability language (map = evidence)', () => {
    const blob = JSON.stringify({ venue: mapVenue(vrow()), coverage: buildVenueCoverage([]) }).toLowerCase();
    for (const term of ['travel', 'impact', 'distance', 'predicted', 'probability', 'advantage', 'disadvantage', 'verdict']) {
      assert.equal(blob.includes(term), false, `venue must not emit "${term}"`);
    }
  });
});
