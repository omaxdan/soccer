// ─────────────────────────────────────────────────────────────────────────────
// GOVERNED INVALIDATION — read-path enforcement proofs (Gate 87, migration 035).
//
// DB-FREE by construction: it opens no connection and imports no DB primitive. It
// proves that every production-intelligence read path honors the append-only
// quarantine relations of migration 035, and that the honoring is a NO-OP while
// the quarantine tables are empty (which they are — this migration classifies
// nothing). The proofs are of two kinds:
//
//   • SQL SHAPE — the exported query text contains the exact quarantine anti-join,
//     with the correct composite target identity, positioned among the DISTINCT ON
//     candidates (so a quarantined "current" reading falls through to the prior
//     good one) and leaving the established DISTINCT ON / ORDER BY / gates intact.
//   • WRITE-BOUNDARY GUARD — the calibration attach path refuses, fail-closed, to
//     attach an outcome to a quarantined snapshot, and proceeds normally when the
//     snapshot is not quarantined.
//
// It asserts NO classification and inserts NO quarantine row. The anti-joins carry
// no new bind parameter, so the readers' existing call signatures are unchanged.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { CURRENT_TEAM_READINGS_SQL, readCurrentTeamReadings } from '../../module/read/readings';
import { CURRENT_READING_EVIDENCE_SQL } from '../../module/read/evidence';
import { CURRENT_SPOKE_CTE } from '../../snapshot/read/selection';
import { ELIGIBLE_SQL } from '../read/eligibleOutcomes';
import { attachOutcomeLink } from '../outcome/attach';
import type { EligibleOutcomeUnit } from '../read/eligibleOutcomes';

// The module-reading anti-join, expected verbatim (whitespace-insensitive) in each
// of the three module-reading readers. Composite over the partitioned identity.
const MODULE_ANTI_JOIN =
  /NOT EXISTS \(\s*SELECT 1 FROM module\.module_reading_quarantine q\s+WHERE q\.module_reading_id = mr\.id\s+AND q\.reading_as_of = mr\.as_of\s*\)/;

// The snapshot anti-join, expected in the calibration eligibility selection.
const SNAPSHOT_ANTI_JOIN =
  /NOT EXISTS \(\s*SELECT 1 FROM snapshot\.match_snapshot_quarantine q\s+WHERE q\.match_snapshot_id = ms\.id\s+AND q\.fixture_partition_on = ms\.fixture_partition_on\s*\)/;

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-READING READERS — exclude quarantined readings among DISTINCT ON candidates
// ─────────────────────────────────────────────────────────────────────────────
describe('035 · module-reading readers honor the quarantine', () => {
  test('(1) readings.ts anti-joins the module quarantine on the exact composite identity', () => {
    assert.match(CURRENT_TEAM_READINGS_SQL, MODULE_ANTI_JOIN);
  });

  test('(2) readings.ts keeps the DISTINCT ON current-reading selection intact', () => {
    // The exclusion is a WHERE predicate, so DISTINCT ON still picks the greatest
    // as_of among the SURVIVING (non-quarantined) rows — the prior good reading.
    assert.match(
      CURRENT_TEAM_READINGS_SQL,
      /DISTINCT ON \(mr\.subject_team_id, mr\.module_definition_id, mr\.context_kind_code, mr\.context_competition_edition_id\)/
    );
    assert.match(CURRENT_TEAM_READINGS_SQL, /ORDER BY[\s\S]*mr\.as_of DESC, mr\.calculated_at DESC, mr\.id DESC/);
    // The anti-join precedes the final ORDER BY (i.e. it is a candidate filter).
    const antiIdx = CURRENT_TEAM_READINGS_SQL.search(/module_reading_quarantine/);
    const orderIdx = CURRENT_TEAM_READINGS_SQL.search(/ORDER BY mr\.subject_team_id/);
    assert.ok(antiIdx > 0 && orderIdx > antiIdx, 'anti-join must sit in WHERE, before the final ORDER BY');
  });

  test('(3) readings.ts stays read-only (the anti-join is a SELECT-1 subquery only)', () => {
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(CURRENT_TEAM_READINGS_SQL));
  });

  test('(4) evidence.ts anti-joins the quarantine and still excludes INACTIVE', () => {
    assert.match(CURRENT_READING_EVIDENCE_SQL, MODULE_ANTI_JOIN);
    assert.match(CURRENT_READING_EVIDENCE_SQL, /mr\.module_status_code <> 'INACTIVE'/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(CURRENT_READING_EVIDENCE_SQL));
  });

  test('(5) snapshot selection (sealing) anti-joins the quarantine so it is never cited', () => {
    assert.match(CURRENT_SPOKE_CTE, MODULE_ANTI_JOIN);
    // The subject-aware DISTINCT ON is unchanged.
    assert.match(CURRENT_SPOKE_CTE, /DISTINCT ON \(mr\.subject_kind_code, mr\.subject_team_id, mr\.subject_fixture_id,/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(CURRENT_SPOKE_CTE));
  });

  test('(6) all three module readers target module.module_reading_quarantine specifically', () => {
    for (const sql of [CURRENT_TEAM_READINGS_SQL, CURRENT_READING_EVIDENCE_SQL, CURRENT_SPOKE_CTE]) {
      assert.match(sql, /module\.module_reading_quarantine/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT READER — calibration eligibility excludes quarantined snapshots
// ─────────────────────────────────────────────────────────────────────────────
describe('035 · calibration accrual honors the snapshot quarantine', () => {
  test('(7) eligibleOutcomes anti-joins the snapshot quarantine on the exact composite identity', () => {
    assert.match(ELIGIBLE_SQL, SNAPSHOT_ANTI_JOIN);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(ELIGIBLE_SQL));
  });

  test('(8) eligibleOutcomes preserves the KICKOFF + COMPLETED + TRACKED-universe gates', () => {
    assert.match(ELIGIBLE_SQL, /ms\.snapshot_point_code = 'KICKOFF'/);
    assert.match(ELIGIBLE_SQL, /f\.lifecycle_state_code = 'COMPLETED'/);
    assert.match(ELIGIBLE_SQL, /governance\.tracked_edition te/);
    assert.match(ELIGIBLE_SQL, /tc\.tracking_status_code = 'TRACKED'/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NO-OP-WHEN-EMPTY + WRITE-BOUNDARY GUARD (behavioral, capture tx — no DB)
// ─────────────────────────────────────────────────────────────────────────────

/** A minimal capture tx; routes queries by SQL content so attach can be exercised. */
function makeTx(handler: (sql: string, params: unknown[]) => { rows?: unknown[]; rowCount?: number }) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const tx = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const r = handler(sql, params);
      return { rows: r.rows ?? [], rowCount: r.rowCount ?? (r.rows ? r.rows.length : 0) };
    },
  };
  return { tx, calls };
}

const UNIT: EligibleOutcomeUnit = {
  matchSnapshotId: '5',
  fixturePartitionOn: '2027-07-01',
  snapshotAsOf: new Date('2027-07-01T00:00:00Z'),
  fixtureId: '9',
  resultId: '3',
  homeGoals: 2,
  awayGoals: 1,
  existingOrdinal: null,
  existingOutcomeValue: null,
  existingResultId: null,
};

describe('035 · module readers add no new bind parameter (anti-join is parameter-free)', () => {
  test('(9) readCurrentTeamReadings still binds exactly the four positional params', async () => {
    const { tx, calls } = makeTx(() => ({ rows: [] }));
    const asOf = new Date('2027-06-02T00:00:00Z');
    await readCurrentTeamReadings(tx as never, {
      teamIds: ['18', '19'],
      asOf,
      moduleKeys: ['home_away_split'],
      contextCompetitionEditionId: '42',
    });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, [['18', '19'], asOf, ['home_away_split'], '42']);
  });
});

describe('035 · attach.ts refuses a quarantined snapshot (defense in depth)', () => {
  test('(10) attach throws and inserts nothing when the snapshot is quarantined', async () => {
    const { tx, calls } = makeTx((sql) => {
      if (sql.includes('match_snapshot_quarantine')) return { rowCount: 1, rows: [{}] };
      return { rowCount: 0, rows: [] };
    });
    await assert.rejects(
      () => attachOutcomeLink(tx as never, UNIT, '77'),
      /quarantined snapshot 5/
    );
    // Only the quarantine probe ran; no INSERT was attempted.
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /match_snapshot_quarantine/);
    assert.ok(!calls.some((c) => /INSERT INTO snapshot\.snapshot_outcome_link/.test(c.sql)));
  });

  test('(11) attach proceeds to the link INSERT when the snapshot is NOT quarantined', async () => {
    const { tx, calls } = makeTx((sql) => {
      if (sql.includes('match_snapshot_quarantine')) return { rowCount: 0, rows: [] };
      if (/INSERT INTO snapshot\.snapshot_outcome_link\b/.test(sql)) return { rowCount: 1, rows: [] };
      return { rowCount: 0, rows: [] };
    });
    const result = await attachOutcomeLink(tx as never, UNIT, '77');
    assert.deepEqual(result, { linked: 1, superseded: 0, skipped: 0 });
    // The probe ran first, then the outcome-link INSERT.
    assert.match(calls[0].sql, /match_snapshot_quarantine/);
    assert.ok(calls.some((c) => /INSERT INTO snapshot\.snapshot_outcome_link\b/.test(c.sql)));
  });
});
