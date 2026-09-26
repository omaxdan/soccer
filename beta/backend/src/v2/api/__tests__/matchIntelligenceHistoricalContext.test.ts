// MATCH INTELLIGENCE v1 — Historical Response wired as DISPLAYED CONTEXT (DB-free).
// Proves the wiring, not the reader (the reader has its own tests): Historical Response
// appears under match-detail context, uses kickoff as strict asOf, is per home/away, and
// never leaks into cited evidence / verdict / checksum. No provider call, no recompute.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { getMatchDetail } from '../handlers';
import { TEAM_RESULT_SEQUENCE_SQL, HISTORICAL_RESPONSE_VERSION } from '../read/teamHistoricalResponse';

const KICKOFF = new Date('2026-05-01T18:00:00.000Z');

const HEADER = {
  fixture_id: '900', fixture_partition_on: 'p', scheduled_kickoff_at: KICKOFF,
  lifecycle_state_code: 'SCHEDULED', edition_id: '18', season_label: '2026',
  competition_id: '28', competition_name: 'Comp', competition_slug: 'comp',
  home_id: '71', home_name: 'Home', home_slug: 'home',
  away_id: '72', away_name: 'Away', away_slug: 'away',
  home_goals: null, away_goals: null,
};

// Returns the fixture header for the FIRST query (the header gate) and empty rows for every
// subsequent read — so every downstream reader (form, venue form, readings, evidence,
// features, fixture modules, historical response) runs against an honest empty substrate.
function captureTx() {
  const calls: { sql: string; params: unknown[] }[] = [];
  let first = true;
  const tx = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (first) { first = false; return { rows: [HEADER] }; }
      return { rows: [] };
    },
  } as unknown as PoolClient;
  return { tx, calls };
}

describe('MI v1 · Historical Response as displayed context', () => {
  test('appears under match-detail context, per home/away, governed shape', async () => {
    const { tx } = captureTx();
    const detail = await getMatchDetail(tx, '900');
    assert.ok(detail);
    const hr = (detail as any).historicalResponse;
    assert.ok(hr && hr.home && hr.away, 'historicalResponse.home/away present');
    assert.equal(hr.home.subjectId, '71');
    assert.equal(hr.away.subjectId, '72');
    assert.equal(hr.home.scope, 'ALL_COMPETITIONS');
    assert.equal(hr.home.version, HISTORICAL_RESPONSE_VERSION);
    // empty substrate → neither trigger engaged (n>=10 gate), no fabricated pattern
    assert.equal(hr.home.anyEngaged, false);
    assert.equal(hr.home.triggers.POST_WIN.engaged, false);
  });

  test('Historical Response reads use the KICKOFF as strict asOf (no future leakage)', async () => {
    const { tx, calls } = captureTx();
    await getMatchDetail(tx, '900');
    const hrCalls = calls.filter((c) => c.sql === TEAM_RESULT_SEQUENCE_SQL);
    assert.equal(hrCalls.length, 2); // exactly home + away, bounded (not N+1)
    for (const c of hrCalls) {
      const asOf = c.params[1] as Date;
      assert.equal(asOf.getTime(), KICKOFF.getTime()); // asOf === kickoff; reader SQL enforces `< asOf`
    }
    assert.deepEqual(hrCalls.map((c) => c.params[0]).sort(), ['71', '72']);
  });

  test('displayed context does NOT expose cited evidence (separation preserved)', async () => {
    const { tx } = captureTx();
    const detail = await getMatchDetail(tx, '900');
    // MatchDetailResponse (the context object) carries no citedEvidence — that lives only
    // inside the sealed intelligence object, which this composition never touches.
    assert.equal((detail as any).citedEvidence, undefined);
    assert.equal((detail as any).verdict, undefined);
    assert.equal((detail as any).contentChecksum, undefined);
  });

  test('deterministic + no predictive/probability fields in the wired context', async () => {
    const { tx } = captureTx();
    const a = await getMatchDetail(tx, '900');
    const { tx: tx2 } = captureTx();
    const b = await getMatchDetail(tx2, '900');
    assert.deepEqual(a, b);
    const json = JSON.stringify((a as any).historicalResponse).toLowerCase();
    for (const banned of ['probab', 'percent', 'confidence', 'likely', 'expected', 'forecast', 'predict']) {
      assert.ok(!json.includes(banned), `no "${banned}" in historicalResponse`);
    }
  });
});
