// COMPETITION / EDITION WORKSPACE LOGIC TESTS (DB-free, pure).
//
// Tab resolution (with legacy fold) + namespace-neutral tab hrefs, fixture selectors
// (recent results / next scheduled / per-status / status counts / day grouping), edition
// fixture facts, season sorting, and date formatting. Guards: no fabricated data, no
// /pitch links, honest empties, status never relabelled by the clock.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveEditionTab, editionTabHref, EDITION_TABS,
  recentResults, nextScheduled, fixturesForStatus, statusCounts,
  groupFixturesByDay, editionFixtureFacts, sortSeasonsDesc, formatAsOf,
} from '../competition';
import type { ApiEditionFixture, ApiEditionSummary } from '../types';

function team(name: string) {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '');
  return { id, name, slug: `${id}` };
}
function fx(id: string, kickoffAt: string, status: string, home: string, away: string, score: { home: number; away: number } | null = null): ApiEditionFixture {
  return { fixtureId: id, kickoffAt, status, homeTeam: team(home), awayTeam: team(away), score };
}

describe('tab resolution & hrefs', () => {
  test('accepts the three shipped tabs; unknown/absent → overview', () => {
    assert.equal(resolveEditionTab('overview'), 'overview');
    assert.equal(resolveEditionTab('table'), 'table');
    assert.equal(resolveEditionTab('fixtures'), 'fixtures');
    assert.equal(resolveEditionTab('bogus'), 'overview');
    assert.equal(resolveEditionTab(undefined), 'overview');
  });
  test('legacy ?tab= values fold onto the new grammar', () => {
    assert.equal(resolveEditionTab('matches'), 'fixtures');
    assert.equal(resolveEditionTab('standings'), 'table');
    assert.equal(resolveEditionTab('teams'), 'overview');
    assert.equal(resolveEditionTab('intelligence'), 'overview');
  });
  test('editionTabHref: overview is the clean base; others add ?tab=; never /pitch', () => {
    assert.equal(editionTabHref('88', 'overview'), '/v2/editions/88');
    assert.equal(editionTabHref('88', 'table'), '/v2/editions/88?tab=table');
    assert.equal(editionTabHref('88', 'fixtures'), '/v2/editions/88?tab=fixtures');
    for (const t of EDITION_TABS) assert.equal(editionTabHref('88', t.key).includes('/pitch'), false);
    for (const t of EDITION_TABS) assert.equal(editionTabHref('88', t.key).startsWith('/v2/editions/88'), true);
  });
  test('editionTabHref accepts an edition ref to build the readable slug base', () => {
    const ref = { id: '18', competition: { slug: 'premier-league' }, seasonLabel: '2026' };
    assert.equal(editionTabHref(ref, 'overview'), '/v2/editions/premier-league-2026-18');
    assert.equal(editionTabHref(ref, 'table'), '/v2/editions/premier-league-2026-18?tab=table');
  });
});

describe('fixture selectors (status as supplied — never relabelled by clock)', () => {
  const fixtures = [
    fx('3', '2026-09-20T18:00:00.000Z', 'SCHEDULED', 'A', 'B'),
    fx('1', '2026-09-06T15:00:00.000Z', 'COMPLETED', 'C', 'D', { home: 2, away: 1 }),
    fx('2', '2026-09-13T12:30:00.000Z', 'IN_PROGRESS', 'E', 'F'),
    fx('4', '2026-09-01T15:00:00.000Z', 'COMPLETED', 'G', 'H', { home: 0, away: 0 }),
    fx('5', '2026-08-30T18:00:00.000Z', 'SCHEDULED', 'I', 'J'),   // earlier than a completed one
    fx('6', '2026-09-09T18:00:00.000Z', 'POSTPONED', 'K', 'L'),
  ];
  test('recentResults: COMPLETED only, newest first, honouring limit', () => {
    assert.deepEqual(recentResults(fixtures).map((f) => f.fixtureId), ['1', '4']);
    assert.deepEqual(recentResults(fixtures, 1).map((f) => f.fixtureId), ['1']);
  });
  test('nextScheduled: strictly SCHEDULED (not POSTPONED), earliest first', () => {
    assert.deepEqual(nextScheduled(fixtures).map((f) => f.fixtureId), ['5', '3']);
  });
  test('fixturesForStatus: filtered + ordered; does not mutate input', () => {
    const before = fixtures.map((f) => f.fixtureId);
    assert.deepEqual(fixturesForStatus(fixtures, 'COMPLETED').map((f) => f.fixtureId), ['1', '4']);
    assert.deepEqual(fixturesForStatus(fixtures, 'POSTPONED').map((f) => f.fixtureId), ['6']);
    assert.deepEqual(fixtures.map((f) => f.fixtureId), before);
  });
  test('statusCounts: only present statuses, in stable display order', () => {
    assert.deepEqual(statusCounts(fixtures), [
      { status: 'COMPLETED', count: 2 },
      { status: 'IN_PROGRESS', count: 1 },
      { status: 'SCHEDULED', count: 2 },
      { status: 'POSTPONED', count: 1 },
    ]);
  });
  test('empty input → empty selectors (absence stays absence)', () => {
    assert.deepEqual(recentResults([]), []);
    assert.deepEqual(nextScheduled([]), []);
    assert.deepEqual(statusCounts([]), []);
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

describe('edition fixture facts (derived from real kickoffs)', () => {
  test('first/last kickoff + latest completed result', () => {
    const facts = editionFixtureFacts([
      fx('1', '2026-01-28T22:00:00.000Z', 'COMPLETED', 'A', 'B', { home: 0, away: 1 }),
      fx('2', '2026-09-07T23:00:00.000Z', 'COMPLETED', 'C', 'D', { home: 1, away: 0 }),
      fx('3', '2026-09-20T14:00:00.000Z', 'SCHEDULED', 'E', 'F'),
    ]);
    assert.equal(facts.count, 3);
    assert.equal(facts.firstKickoff, '2026-01-28T22:00:00.000Z');
    assert.equal(facts.lastKickoff, '2026-09-20T14:00:00.000Z');
    assert.equal(facts.latestResult, '2026-09-07T23:00:00.000Z');
  });
  test('no fixtures → all nulls (never zero-filled)', () => {
    assert.deepEqual(editionFixtureFacts([]), { count: 0, firstKickoff: null, lastKickoff: null, latestResult: null });
  });
});

describe('season sorting', () => {
  const editions: ApiEditionSummary[] = [
    { id: '10', seasonLabel: '2024', competition: { id: 'c1', name: 'Série A', slug: 'serie-a' }, fixtureCount: 380 },
    { id: '11', seasonLabel: '2026', competition: { id: 'c1', name: 'Série A', slug: 'serie-a' }, fixtureCount: 120 },
  ];
  test('newest season label first; does not mutate input', () => {
    const before = editions.map((e) => e.id);
    assert.deepEqual(sortSeasonsDesc(editions).map((e) => e.id), ['11', '10']);
    assert.deepEqual(editions.map((e) => e.id), before);
  });
});

describe('as-of formatting (point-in-time never hidden)', () => {
  test('YYYY-MM-DD → DD Mon YYYY', () => {
    assert.equal(formatAsOf('2026-08-11'), '11 Aug 2026');
    assert.equal(formatAsOf('2026-12-01'), '1 Dec 2026');
  });
  test('non-date input passes through unchanged', () => {
    assert.equal(formatAsOf('not-a-date'), 'not-a-date');
  });
});
