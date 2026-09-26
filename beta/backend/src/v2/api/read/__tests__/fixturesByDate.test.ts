// FIXTURES BY DATE — DB-free tests (fake PoolClient + pure assembler). No provider, no DB.
// Covers date semantics, country→competition→edition grouping, deterministic ordering, all
// lifecycle states, the canonical match-result object (final/HT/ET/pens/confirmedAt),
// confirmed 0-0 vs null, empty date, UTC boundary, invalid date, and read-only behavior.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  parseUtcCalendarDate, isValidCalendarDate, assembleFixturesByDate, readFixturesByDate,
  FIXTURES_BY_DATE_SQL, type CalendarRow,
} from '../fixturesByDate';

function row(over: Partial<CalendarRow> & Pick<CalendarRow, 'fixture_id' | 'status'>): CalendarRow {
  return {
    scheduled_kickoff_at: '2026-09-26T18:00:00.000Z',
    country_code: 'BR', country_name: 'Brazil',
    competition_id: 'c1', competition_name: 'Série A', competition_slug: 'serie-a',
    edition_id: 'e1', season_label: '2026',
    home_id: 'h', home_name: 'Home', home_slug: 'home',
    away_id: 'a', away_name: 'Away', away_slug: 'away',
    home_goals: null, away_goals: null,
    home_goals_half_time: null, away_goals_half_time: null,
    home_goals_extra_time: null, away_goals_extra_time: null,
    home_penalties: null, away_penalties: null, confirmed_at: null,
    ...over,
  } as CalendarRow;
}

// ── date semantics ──────────────────────────────────────────────────────────────

describe('parseUtcCalendarDate / isValidCalendarDate', () => {
  test('valid date → half-open UTC window [D, D+1)', () => {
    assert.deepEqual(parseUtcCalendarDate('2026-09-26'), {
      startIso: '2026-09-26T00:00:00.000Z', endIso: '2026-09-27T00:00:00.000Z',
    });
  });
  test('month boundary rolls to the next day, not the next month', () => {
    assert.equal(parseUtcCalendarDate('2026-09-30')!.endIso, '2026-10-01T00:00:00.000Z');
  });
  test('rejects malformed and non-existent dates', () => {
    for (const bad of ['2026-9-6', '20260926', '2026-13-01', '2026-02-30', 'today', '', '2026-09-26T00:00:00Z']) {
      assert.equal(parseUtcCalendarDate(bad), null, bad);
      assert.equal(isValidCalendarDate(bad), false, bad);
    }
    assert.equal(isValidCalendarDate('2026-09-26'), true);
  });
});

// ── grouping + ordering ─────────────────────────────────────────────────────────

describe('assembleFixturesByDate — grouping & ordering', () => {
  test('groups country → competition → edition → fixtures, echoes date + count', () => {
    const rows = [
      row({ fixture_id: '1', status: 'SCHEDULED' }),
      row({ fixture_id: '2', status: 'SCHEDULED', scheduled_kickoff_at: '2026-09-26T20:00:00.000Z' }),
    ];
    const r = assembleFixturesByDate('2026-09-26', rows);
    assert.equal(r.date, '2026-09-26');
    assert.equal(r.fixtureCount, 2);
    assert.equal(r.countries.length, 1);
    assert.equal(r.countries[0].country!.code, 'BR');
    assert.equal(r.countries[0].competitions[0].edition.editionId, 'e1');
    assert.deepEqual(r.countries[0].competitions[0].fixtures.map((f) => f.fixtureId), ['1', '2']);
  });

  test('separate countries and competitions become separate groups (order preserved from SQL)', () => {
    const rows = [
      row({ fixture_id: '1', status: 'COMPLETED', country_code: 'BR', country_name: 'Brazil', competition_id: 'c1' }),
      row({ fixture_id: '2', status: 'COMPLETED', country_code: 'EN', country_name: 'England', competition_id: 'c2', competition_name: 'PL', competition_slug: 'pl', edition_id: 'e2' }),
    ];
    const r = assembleFixturesByDate('2026-09-26', rows);
    assert.deepEqual(r.countries.map((c) => c.country!.code), ['BR', 'EN']);
  });

  test('null country becomes a null bucket, never fabricated', () => {
    const r = assembleFixturesByDate('2026-09-26', [row({ fixture_id: '1', status: 'SCHEDULED', country_code: null, country_name: null })]);
    assert.equal(r.countries[0].country, null);
  });

  test('same competition, two editions → two competition entries (edition is singular)', () => {
    const rows = [
      row({ fixture_id: '1', status: 'SCHEDULED', edition_id: 'e1', season_label: '2026' }),
      row({ fixture_id: '2', status: 'SCHEDULED', edition_id: 'e2', season_label: '2027' }),
    ];
    const r = assembleFixturesByDate('2026-09-26', rows);
    assert.equal(r.countries[0].competitions.length, 2);
    assert.deepEqual(r.countries[0].competitions.map((c) => c.edition.editionId), ['e1', 'e2']);
  });
});

// ── all lifecycle states included ───────────────────────────────────────────────

describe('assembleFixturesByDate — status semantics', () => {
  test('every governed lifecycle state is included verbatim (not filtered to COMPLETED)', () => {
    const states = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED', 'ABANDONED', 'CANCELLED', 'UNKNOWN'];
    const rows = states.map((s, i) => row({ fixture_id: String(i), status: s, scheduled_kickoff_at: `2026-09-26T${String(10 + i).padStart(2, '0')}:00:00.000Z` }));
    const r = assembleFixturesByDate('2026-09-26', rows);
    assert.deepEqual(r.countries[0].competitions[0].fixtures.map((f) => f.status), states);
  });
});

// ── canonical result semantics ──────────────────────────────────────────────────

describe('assembleFixturesByDate — canonical match result', () => {
  test('completed with confirmed result → full canonical result + legacy score', () => {
    const r = assembleFixturesByDate('2026-09-26', [row({
      fixture_id: '1', status: 'COMPLETED',
      home_goals: 2, away_goals: 1, home_goals_half_time: 1, away_goals_half_time: 0,
      confirmed_at: '2026-09-26T20:00:00.000Z',
    })]);
    const f = r.countries[0].competitions[0].fixtures[0];
    assert.deepEqual(f.result!.final, { home: 2, away: 1 });
    assert.deepEqual(f.result!.halfTime, { home: 1, away: 0 });
    assert.equal(f.result!.extraTime, null);
    assert.equal(f.result!.penalties, null);
    assert.equal(f.result!.confirmedAt, '2026-09-26T20:00:00.000Z');
    assert.deepEqual(f.score, { home: 2, away: 1 }); // ApiEditionFixture parity
  });

  test('extra-time + penalties preserved when reported', () => {
    const r = assembleFixturesByDate('2026-09-26', [row({
      fixture_id: '1', status: 'COMPLETED', home_goals: 1, away_goals: 1,
      home_goals_extra_time: 1, away_goals_extra_time: 1, home_penalties: 4, away_penalties: 2,
      confirmed_at: '2026-09-26T21:00:00.000Z',
    })]);
    const res = r.countries[0].competitions[0].fixtures[0].result!;
    assert.deepEqual(res.extraTime, { home: 1, away: 1 });
    assert.deepEqual(res.penalties, { home: 4, away: 2 });
  });

  test('a genuine confirmed 0-0 is a real score, never null', () => {
    const r = assembleFixturesByDate('2026-09-26', [row({
      fixture_id: '1', status: 'COMPLETED', home_goals: 0, away_goals: 0, confirmed_at: '2026-09-26T20:00:00.000Z',
    })]);
    const f = r.countries[0].competitions[0].fixtures[0];
    assert.deepEqual(f.result!.final, { home: 0, away: 0 });
    assert.deepEqual(f.score, { home: 0, away: 0 });
    assert.notEqual(f.result, null);
  });

  test('completed with NO persisted result → result null and score null (missing ≠ zero)', () => {
    const r = assembleFixturesByDate('2026-09-26', [row({ fixture_id: '1', status: 'COMPLETED' })]); // all result cols null
    const f = r.countries[0].competitions[0].fixtures[0];
    assert.equal(f.result, null);
    assert.equal(f.score, null);
  });

  test('scheduled fixture → result null, score null', () => {
    const f = assembleFixturesByDate('2026-09-26', [row({ fixture_id: '1', status: 'SCHEDULED' })]).countries[0].competitions[0].fixtures[0];
    assert.equal(f.result, null);
    assert.equal(f.score, null);
  });
});

// ── empty + read chain + invalid date ───────────────────────────────────────────

function fakeTx(rows: CalendarRow[]): { tx: PoolClient; queries: string[]; params: unknown[][] } {
  const queries: string[] = []; const params: unknown[][] = [];
  const query = async (sql: string, p: unknown[] = []) => { queries.push(sql); params.push(p); return { rows, rowCount: rows.length }; };
  return { tx: { query } as unknown as PoolClient, queries, params };
}

describe('readFixturesByDate — read chain (fake tx)', () => {
  test('empty date → 200-worthy empty response, one read-only SELECT with the UTC window', async () => {
    const f = fakeTx([]);
    const r = await readFixturesByDate(f.tx, '2026-09-26');
    assert.deepEqual(r, { date: '2026-09-26', fixtureCount: 0, countries: [] });
    assert.equal(f.queries.length, 1);
    assert.equal(f.queries[0], FIXTURES_BY_DATE_SQL);                 // the exact set-based read
    assert.deepEqual(f.params[0], ['2026-09-26T00:00:00.000Z', '2026-09-27T00:00:00.000Z']); // half-open UTC window
    assert.ok(/scheduled_kickoff_at >= \$1/.test(FIXTURES_BY_DATE_SQL) && /scheduled_kickoff_at <  \$2/.test(FIXTURES_BY_DATE_SQL));
    assert.ok(!/fixture_partition_on\s*>=|fixture_partition_on\s*=\s*\$/.test(FIXTURES_BY_DATE_SQL)); // never filters on the partition date
  });

  test('invalid date → null WITHOUT issuing any query (400 upstream)', async () => {
    const f = fakeTx([]);
    assert.equal(await readFixturesByDate(f.tx, '2026-13-40'), null);
    assert.equal(f.queries.length, 0);
  });

  test('populated date maps rows into the grouped response', async () => {
    const f = fakeTx([row({ fixture_id: '1', status: 'COMPLETED', home_goals: 3, away_goals: 0, confirmed_at: '2026-09-26T20:00:00.000Z' })]);
    const r = await readFixturesByDate(f.tx, '2026-09-26');
    assert.equal(r!.fixtureCount, 1);
    assert.deepEqual(r!.countries[0].competitions[0].fixtures[0].result!.final, { home: 3, away: 0 });
  });
});

// ── the SQL never exposes provider fields ────────────────────────────────────────

describe('fixturesByDate — governance', () => {
  test('the query selects neither provider_external_id nor provider_status_raw', () => {
    assert.ok(!/provider_external_id|provider_status_raw/.test(FIXTURES_BY_DATE_SQL));
    assert.ok(/f\.lifecycle_state_code\s+AS status/.test(FIXTURES_BY_DATE_SQL)); // governed status only
  });
});
