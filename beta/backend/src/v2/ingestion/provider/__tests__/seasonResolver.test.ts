// ─────────────────────────────────────────────────────────────────────────────
// SEASON RESOLVER TESTS — pure, deterministic, no network and no database.
//
// Evidence base: the season arrays below are the ACTUAL provider payloads captured
// under docs/api-samples/v2-discovery/tournament_seasons__* (England id 17,
// Brazil id 325), reproduced here as fixtures so the resolver is exercised against
// real shapes. `now` is always injected — the resolver never reads the clock — so
// every assertion is reproducible regardless of the wall clock the suite runs on.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normaliseSeasons,
  parseSeasonSpan,
  classifySeason,
  resolveCurrentSeason,
} from '../seasons';

// A stable "now" inside the 2026/27 European season and the 2026 calendar year.
const NOW = new Date('2026-09-10T00:00:00Z');

// Real England (tournament 17) envelope, trimmed to the recent seasons.
const ENGLAND_ENVELOPE = {
  success: true,
  source: 'live',
  tournamentId: 17,
  seasons: [
    { id: 96668, name: 'Premier League 26/27', year: '26/27', tournamentId: 17 },
    { id: 76986, name: 'Premier League 25/26', year: '25/26', tournamentId: 17 },
    { id: 61627, name: 'Premier League 24/25', year: '24/25', tournamentId: 17 },
    { id: 52186, name: 'Premier League 23/24', year: '23/24', tournamentId: 17 },
  ],
};

// Real Brazil (tournament 325) envelope — CALENDAR-year competition.
const BRAZIL_ENVELOPE = {
  success: true,
  source: 'live',
  tournamentId: 325,
  seasons: [
    { id: 87678, name: 'Brasileiro Serie A 2026', year: '2026', tournamentId: 325 },
    { id: 72034, name: 'Brasileiro Serie A 2025', year: '2025', tournamentId: 325 },
    { id: 58766, name: 'Brasileirão Betano 2024', year: '2024', tournamentId: 325 },
  ],
};

describe('normaliseSeasons · envelope handling', () => {
  test('reads the provider {seasons:[...]} envelope, preserving order + index', () => {
    const seasons = normaliseSeasons(ENGLAND_ENVELOPE);
    assert.equal(seasons.length, 4);
    assert.equal(seasons[0].id, '96668');
    assert.equal(seasons[0].index, 0);
    assert.equal(seasons[3].index, 3);
    assert.equal(seasons[0].year, '26/27');
  });

  test('reads a bare array and a data-wrapped array', () => {
    assert.equal(normaliseSeasons(ENGLAND_ENVELOPE.seasons).length, 4);
    assert.equal(normaliseSeasons({ data: { seasons: ENGLAND_ENVELOPE.seasons } }).length, 4);
    assert.equal(normaliseSeasons({ results: ENGLAND_ENVELOPE.seasons }).length, 4);
  });

  test('never throws on absent / malformed payloads', () => {
    assert.deepEqual(normaliseSeasons(null), []);
    assert.deepEqual(normaliseSeasons(undefined), []);
    assert.deepEqual(normaliseSeasons({}), []);
    assert.deepEqual(normaliseSeasons({ seasons: 'not-an-array' }), []);
    assert.deepEqual(normaliseSeasons({ seasons: [] }), []);
    // bad entries are skipped, good ones kept
    const mixed = normaliseSeasons({ seasons: [{ noId: true }, { id: 5, name: 'x', year: '2026' }] });
    assert.equal(mixed.length, 1);
    assert.equal(mixed[0].id, '5');
  });
});

describe('parseSeasonSpan · year formats', () => {
  test('CALENDAR "2026" spans the calendar year', () => {
    const s = parseSeasonSpan('2026');
    assert.equal(s.format, 'CALENDAR');
    assert.equal(s.startsAt?.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(s.endsBefore?.toISOString(), '2027-01-01T00:00:00.000Z');
  });

  test('SPLIT "26/27" spans July→July', () => {
    const s = parseSeasonSpan('26/27');
    assert.equal(s.format, 'SPLIT');
    assert.equal(s.startsAt?.toISOString(), '2026-07-01T00:00:00.000Z');
    assert.equal(s.endsBefore?.toISOString(), '2027-07-01T00:00:00.000Z');
  });

  test('falls back to a year token embedded in the name', () => {
    assert.equal(parseSeasonSpan(null, 'Premier League 26/27').format, 'SPLIT');
    assert.equal(parseSeasonSpan(null, 'Brasileiro Serie A 2026').format, 'CALENDAR');
  });

  test('unparseable metadata is UNKNOWN, not a guess', () => {
    assert.equal(parseSeasonSpan(null, 'no year here').format, 'UNKNOWN');
    assert.equal(parseSeasonSpan('Apertura').format, 'UNKNOWN');
    assert.equal(parseSeasonSpan('27/26').format, 'UNKNOWN'); // descending → refused
  });
});

describe('resolveCurrentSeason · required behaviours', () => {
  test('1. first candidate clearly current → selected (England 26/27, CURRENT_FIRST)', () => {
    const r = resolveCurrentSeason(normaliseSeasons(ENGLAND_ENVELOPE), NOW);
    assert.equal(r.kind, 'RESOLVED');
    if (r.kind !== 'RESOLVED') return;
    assert.equal(r.season.id, '96668');
    assert.equal(r.basis, 'CURRENT_FIRST');
  });

  test('1b. calendar-year competition resolves too (Brazil 2026)', () => {
    const r = resolveCurrentSeason(normaliseSeasons(BRAZIL_ENVELOPE), NOW);
    assert.equal(r.kind, 'RESOLVED');
    if (r.kind !== 'RESOLVED') return;
    assert.equal(r.season.id, '87678');
    assert.equal(r.classified.span.format, 'CALENDAR');
  });

  test('2. first candidate not current but another is → correct one chosen (CURRENT_SCAN)', () => {
    // A provider that has prepended a not-yet-started 27/28 season.
    const seasons = normaliseSeasons({
      seasons: [
        { id: 111111, name: 'Premier League 27/28', year: '27/28', tournamentId: 17 },
        ...ENGLAND_ENVELOPE.seasons,
      ],
    });
    const r = resolveCurrentSeason(seasons, NOW);
    assert.equal(r.kind, 'RESOLVED');
    if (r.kind !== 'RESOLVED') return;
    assert.equal(r.season.id, '96668');
    assert.equal(r.basis, 'CURRENT_SCAN');
  });

  test('3. only a future season → rejected for current resolution (UNRESOLVED)', () => {
    const seasons = normaliseSeasons({
      seasons: [{ id: 111111, name: 'Premier League 27/28', year: '27/28', tournamentId: 17 }],
    });
    const r = resolveCurrentSeason(seasons, NOW);
    assert.equal(r.kind, 'UNRESOLVED');
  });

  test('4. ended seasons are rejected when a current one exists', () => {
    const r = resolveCurrentSeason(normaliseSeasons(ENGLAND_ENVELOPE), NOW);
    assert.equal(r.kind, 'RESOLVED');
    if (r.kind !== 'RESOLVED') return;
    assert.notEqual(r.season.id, '76986'); // 25/26 has ended by 2026-09-10
    // and 25/26 classifies PAST
    const past = classifySeason(normaliseSeasons(ENGLAND_ENVELOPE)[1], NOW);
    assert.equal(past.temporalClass, 'PAST');
  });

  test('4b. off-season with no current → UNRESOLVED (Brazil in January, no new season yet)', () => {
    const jan = new Date('2027-01-15T00:00:00Z');
    const r = resolveCurrentSeason(normaliseSeasons(BRAZIL_ENVELOPE), jan);
    assert.equal(r.kind, 'UNRESOLVED'); // 2026 ended, 2027 not yet listed
  });

  test('5. ambiguous (two current) → safe UNRESOLVED', () => {
    const seasons = normaliseSeasons({
      seasons: [
        { id: 1, name: 'Dup A 26/27', year: '26/27', tournamentId: 17 },
        { id: 2, name: 'Dup B 26/27', year: '26/27', tournamentId: 17 },
      ],
    });
    const r = resolveCurrentSeason(seasons, NOW);
    assert.equal(r.kind, 'UNRESOLVED');
    assert.match((r as { reason: string }).reason, /ambiguous/);
  });

  test('6. empty provider response → safe UNRESOLVED, no throw', () => {
    const r = resolveCurrentSeason([], NOW);
    assert.equal(r.kind, 'UNRESOLVED');
    assert.equal((r as { candidatesConsidered: number }).candidatesConsidered, 0);
  });

  test('7. historical override → explicit operator selection works', () => {
    const r = resolveCurrentSeason(normaliseSeasons(ENGLAND_ENVELOPE), NOW, {
      overrideSeasonId: '61627',
    });
    assert.equal(r.kind, 'RESOLVED_BY_OVERRIDE');
    if (r.kind !== 'RESOLVED_BY_OVERRIDE') return;
    assert.equal(r.season.id, '61627');
  });

  test('7b. override naming an unknown season → UNRESOLVED, never fabricated', () => {
    const r = resolveCurrentSeason(normaliseSeasons(ENGLAND_ENVELOPE), NOW, {
      overrideSeasonId: '99999',
    });
    assert.equal(r.kind, 'UNRESOLVED');
  });

  test('8. numeric id ordering cannot determine the result', () => {
    // Largest id is a FUTURE season; the current one has the SMALLEST id.
    const seasons = normaliseSeasons({
      seasons: [
        { id: 999999, name: 'League 27/28', year: '27/28', tournamentId: 1 },
        { id: 100, name: 'League 26/27', year: '26/27', tournamentId: 1 },
        { id: 500000, name: 'League 25/26', year: '25/26', tournamentId: 1 },
      ],
    });
    const r = resolveCurrentSeason(seasons, NOW);
    assert.equal(r.kind, 'RESOLVED');
    if (r.kind !== 'RESOLVED') return;
    assert.equal(r.season.id, '100', 'the current season is chosen, not the largest id');
  });

  test('8b. summer handoff: future season is first, elder is still current → elder chosen', () => {
    const june = new Date('2026-06-15T00:00:00Z');
    const r = resolveCurrentSeason(normaliseSeasons(ENGLAND_ENVELOPE), june);
    assert.equal(r.kind, 'RESOLVED');
    if (r.kind !== 'RESOLVED') return;
    // 26/27 (first, id 96668) has not started in June; 25/26 is still current.
    assert.equal(r.season.id, '76986');
    assert.equal(r.basis, 'CURRENT_SCAN');
  });

  test('9. missing/unparseable metadata never crashes and yields no false current', () => {
    const seasons = normaliseSeasons({
      seasons: [
        { id: 1, name: 'Apertura', year: null, tournamentId: 1 },
        { id: 2, name: 'Clausura', year: '', tournamentId: 1 },
      ],
    });
    const r = resolveCurrentSeason(seasons, NOW);
    assert.equal(r.kind, 'UNRESOLVED'); // no parseable current; operator must override
  });
});
