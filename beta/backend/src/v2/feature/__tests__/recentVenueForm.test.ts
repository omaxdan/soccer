// RECENT VENUE FORM — PD-11 SELECTION SEMANTICS (DB-free).
//
// Proves the pure, testable half of the Recent Venue Form context surface: the
// venue-side partition, the "five most recent per side" cap, the deterministic
// most-recent-first order, honest fewer-than-five behaviour, and the wire
// projection (opponent / venue / competition mapping, null preservation). The
// strict `scheduled_kickoff_at < asOf` bound and the SQL join live in the read and
// are exercised by the DB-gated api test; here we prove the selection contract that
// no database is needed to verify.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { selectRecentVenueForm, type RecentVenueFormRow } from '../read/recentVenueForm';
import { toTeamRecentVenueForm } from '../../api/handlers';

const row = (over: Partial<RecentVenueFormRow> & { fixtureId: string; kickoffAt: Date; isHome: boolean }): RecentVenueFormRow => ({
  goalsFor: 1,
  goalsAgainst: 0,
  opponent: { id: '900', name: 'Opp', slug: 'opp' },
  venueName: 'Ground',
  competition: { id: '1', name: 'League', slug: 'league' },
  ...over,
});

const day = (n: number) => new Date(Date.UTC(2027, 0, n));

describe('recent venue form · selectRecentVenueForm (PD-11 selection)', () => {
  test('splits by venue side and keeps at most five per side, most recent first', () => {
    const rows: RecentVenueFormRow[] = [];
    for (let i = 1; i <= 7; i++) rows.push(row({ fixtureId: `H${i}`, kickoffAt: day(i), isHome: true }));
    for (let i = 1; i <= 6; i++) rows.push(row({ fixtureId: `A${i}`, kickoffAt: day(i), isHome: false }));

    const out = selectRecentVenueForm(rows);
    assert.equal(out.lastHome.length, 5, 'home capped at five');
    assert.equal(out.lastAway.length, 5, 'away capped at five');
    // Most recent first: the two newest home fixtures (day 7, day 6) lead, day 1/2 dropped.
    assert.deepEqual(out.lastHome.map((r) => r.fixtureId), ['H7', 'H6', 'H5', 'H4', 'H3']);
    assert.deepEqual(out.lastAway.map((r) => r.fixtureId), ['A6', 'A5', 'A4', 'A3', 'A2']);
    assert.ok(out.lastHome.every((r) => r.isHome), 'home side holds only home rows');
    assert.ok(out.lastAway.every((r) => !r.isHome), 'away side holds only away rows');
  });

  test('fewer than five are all shown, never manufactured, never mixed across sides', () => {
    const rows = [
      row({ fixtureId: 'H1', kickoffAt: day(3), isHome: true }),
      row({ fixtureId: 'H2', kickoffAt: day(1), isHome: true }),
      row({ fixtureId: 'A1', kickoffAt: day(2), isHome: false }),
    ];
    const out = selectRecentVenueForm(rows);
    assert.deepEqual(out.lastHome.map((r) => r.fixtureId), ['H1', 'H2']);
    assert.deepEqual(out.lastAway.map((r) => r.fixtureId), ['A1']);
  });

  test('kickoff ties break deterministically by fixture id (total order, R-2)', () => {
    const rows = [
      row({ fixtureId: '10', kickoffAt: day(5), isHome: true }),
      row({ fixtureId: '11', kickoffAt: day(5), isHome: true }),
    ];
    const out = selectRecentVenueForm(rows);
    assert.deepEqual(out.lastHome.map((r) => r.fixtureId), ['11', '10'], 'higher id first on a tie');
  });

  test('empty input yields two empty sides (never fabricated)', () => {
    const out = selectRecentVenueForm([]);
    assert.deepEqual(out, { lastHome: [], lastAway: [] });
  });
});

describe('recent venue form · toTeamRecentVenueForm (wire projection)', () => {
  test('maps opponent / venue / competition and derives no W/D/L (that is presentation-only)', () => {
    const out = toTeamRecentVenueForm([
      row({ fixtureId: 'H1', kickoffAt: day(3), isHome: true, opponent: { id: '5', name: 'Rivals', slug: 'rivals' }, venueName: 'Anfield', competition: { id: '2', name: 'Serie A', slug: 'serie-a' }, goalsFor: 2, goalsAgainst: 1 }),
    ]);
    assert.equal(out.lastHome.length, 1);
    const r = out.lastHome[0];
    assert.equal(r.opponent.name, 'Rivals');
    assert.equal(r.venueName, 'Anfield');
    assert.equal(r.competition.name, 'Serie A');
    assert.equal(r.goalsFor, 2);
    assert.equal(r.goalsAgainst, 1);
    assert.equal(typeof r.kickoffAt, 'string', 'date crosses the wire as ISO string');
    assert.equal((r as unknown as Record<string, unknown>).result, undefined, 'no server-side W/D/L field');
  });

  test('a null venue and a resultless completed fixture are preserved honestly', () => {
    const out = toTeamRecentVenueForm([
      row({ fixtureId: 'A1', kickoffAt: day(1), isHome: false, venueName: null, goalsFor: null, goalsAgainst: null }),
    ]);
    const r = out.lastAway[0];
    assert.equal(r.venueName, null);
    assert.equal(r.goalsFor, null);
    assert.equal(r.goalsAgainst, null);
  });

  test('undefined team rows → two empty sides', () => {
    assert.deepEqual(toTeamRecentVenueForm(undefined), { lastHome: [], lastAway: [] });
  });
});
