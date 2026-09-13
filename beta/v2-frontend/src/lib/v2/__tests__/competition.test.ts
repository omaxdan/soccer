// COMPETITION (EDITION) PAGE LOGIC TESTS (DB-free, pure).
//
// Tab resolution + namespace-neutral tab hrefs, fixture classification/ordering and
// day grouping, derived team discovery (real fixtures only), and sibling-season
// selection. Guards: no fabricated data, no /pitch links, honest empties.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEditionTab, editionTabHref, EDITION_TABS,
  classifyFixtures, groupFixturesByDay, deriveEditionTeams, siblingSeasons,
} from '../competition';
import type { ApiEditionFixture, ApiEditionSummary } from '../types';

// A team's id is stable (one id per club, regardless of home/away) — as in real data.
function team(name: string) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return { id, name, slug: `${id}` };
}
function fx(id: string, kickoffAt: string, status: string, home: string, away: string, score: { home: number; away: number } | null = null): ApiEditionFixture {
  return { fixtureId: id, kickoffAt, status, homeTeam: team(home), awayTeam: team(away), score };
}

describe('tab resolution & hrefs', () => {
  test('resolveEditionTab accepts known tabs and defaults unknown/absent to overview', () => {
    assert.equal(resolveEditionTab('matches'), 'matches');
    assert.equal(resolveEditionTab('standings'), 'standings');
    assert.equal(resolveEditionTab('teams'), 'teams');
    assert.equal(resolveEditionTab('intelligence'), 'intelligence');
    assert.equal(resolveEditionTab('overview'), 'overview');
    assert.equal(resolveEditionTab('bogus'), 'overview');
    assert.equal(resolveEditionTab(undefined), 'overview');
  });
  test('editionTabHref: overview is the clean base; others add ?tab=; never /pitch', () => {
    assert.equal(editionTabHref('88', 'overview'), '/v2/editions/88');
    assert.equal(editionTabHref('88', 'matches'), '/v2/editions/88?tab=matches');
    for (const t of EDITION_TABS) assert.equal(editionTabHref('88', t.key).includes('/pitch'), false);
    for (const t of EDITION_TABS) assert.equal(editionTabHref('88', t.key).startsWith('/v2/editions/88'), true);
  });
  test('editionTabHref accepts an edition ref to build the readable slug base', () => {
    const ref = { id: '18', competition: { slug: 'premier-league' }, seasonLabel: '2026' };
    assert.equal(editionTabHref(ref, 'overview'), '/v2/editions/premier-league-2026-18');
    assert.equal(editionTabHref(ref, 'standings'), '/v2/editions/premier-league-2026-18?tab=standings');
  });
});

describe('fixture classification & ordering', () => {
  const fixtures = [
    fx('3', '2026-09-20T18:00:00.000Z', 'SCHEDULED', 'A', 'B'),
    fx('1', '2026-09-06T15:00:00.000Z', 'COMPLETED', 'C', 'D', { home: 2, away: 1 }),
    fx('2', '2026-09-13T12:30:00.000Z', 'IN_PROGRESS', 'E', 'F'),
    fx('4', '2026-09-01T15:00:00.000Z', 'COMPLETED', 'G', 'H', { home: 0, away: 0 }),
    fx('5', '2026-09-27T18:00:00.000Z', 'SCHEDULED', 'I', 'J'),
  ];
  test('splits into live / upcoming (asc) / recent (desc) by governed status', () => {
    const g = classifyFixtures(fixtures);
    assert.deepEqual(g.live.map((f) => f.fixtureId), ['2']);
    assert.deepEqual(g.upcoming.map((f) => f.fixtureId), ['3', '5']); // ascending kickoff
    assert.deepEqual(g.recent.map((f) => f.fixtureId), ['1', '4']);   // descending kickoff
  });
  test('does not mutate the input array', () => {
    const before = fixtures.map((f) => f.fixtureId);
    classifyFixtures(fixtures);
    assert.deepEqual(fixtures.map((f) => f.fixtureId), before);
  });
  test('empty input yields three empty groups (honest, not fabricated)', () => {
    const g = classifyFixtures([]);
    assert.deepEqual([g.live, g.upcoming, g.recent], [[], [], []]);
  });
});

describe('day grouping', () => {
  test('groups fixtures by UTC calendar day, preserving order', () => {
    const days = groupFixturesByDay([
      fx('1', '2026-09-13T12:30:00.000Z', 'SCHEDULED', 'A', 'B'),
      fx('2', '2026-09-13T18:00:00.000Z', 'SCHEDULED', 'C', 'D'),
      fx('3', '2026-09-14T15:00:00.000Z', 'SCHEDULED', 'E', 'F'),
    ]);
    assert.deepEqual(days.map((d) => d.dayKey), ['2026-09-13', '2026-09-14']);
    assert.deepEqual(days[0].fixtures.map((f) => f.fixtureId), ['1', '2']);
    assert.deepEqual(days[1].fixtures.map((f) => f.fixtureId), ['3']);
  });
});

describe('team discovery (derived from real fixtures)', () => {
  test('collects distinct teams and sorts by name; no invented teams', () => {
    const teams = deriveEditionTeams([
      fx('1', '2026-09-13T12:30:00.000Z', 'SCHEDULED', 'Palmeiras', 'Santos'),
      fx('2', '2026-09-14T12:30:00.000Z', 'SCHEDULED', 'Santos', 'Flamengo'),
    ]);
    assert.deepEqual(teams.map((t) => t.name), ['Flamengo', 'Palmeiras', 'Santos']); // deduped + sorted
  });
  test('no fixtures → no teams (absence stays absence)', () => {
    assert.deepEqual(deriveEditionTeams([]), []);
  });
});

describe('sibling seasons', () => {
  const editions: ApiEditionSummary[] = [
    { id: '10', seasonLabel: '2024', competition: { id: 'c1', name: 'Série A', slug: 'serie-a' }, fixtureCount: 380 },
    { id: '11', seasonLabel: '2026', competition: { id: 'c1', name: 'Série A', slug: 'serie-a' }, fixtureCount: 120 },
    { id: '99', seasonLabel: '2026', competition: { id: 'c2', name: 'Other', slug: 'other' }, fixtureCount: 10 },
  ];
  test('returns only same-competition seasons, newest label first', () => {
    const s = siblingSeasons(editions, 'c1');
    assert.deepEqual(s.map((e) => e.id), ['11', '10']); // 2026 before 2024, c2 excluded
  });
  test('single tracked season → just itself (no fabricated seasons)', () => {
    assert.deepEqual(siblingSeasons(editions, 'c2').map((e) => e.id), ['99']);
  });
});
