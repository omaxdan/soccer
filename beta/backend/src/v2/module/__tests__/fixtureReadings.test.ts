// FIXTURE-SUBJECT MODULE READING READ-SURFACE TESTS (B1 exposure).
//
// DB-free unit tests: the current-reading SQL shape (DISTINCT ON per fixture+module,
// FIXTURE subject filter, fixture id + partition, the temporal as_of CEILING, module
// filter, quarantine exclusion, ordering), row mapping/coercion, and param binding.
// The temporal ceiling is the safety-critical assertion — a future-dated reading must
// never be selectable for pre-match consumption.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  readFixtureModuleReadings,
  mapFixtureReadingRow,
  CURRENT_FIXTURE_READINGS_SQL,
  FIXTURE_MATCH_MODULE_KEYS,
} from '../read/fixtureReadings';

function captureTx(rows: unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const tx = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows };
    },
  } as unknown as PoolClient;
  return { tx, calls };
}

const sampleRow = {
  module_key: 'form_gap_accuracy',
  fixture_id: '292',
  as_of: new Date('2026-08-23T17:30:00Z'),
  calculated_at: new Date('2026-08-23T18:00:00Z'),
  module_status_code: 'SUPPORTS',
  strength: null,
  confidence: null,
  sample_observation_count: 6,
  sample_meets_threshold: true,
  verdict_text: 'Home venue form stronger by 12.50.',
  inactive_reason: null,
};

describe('fixture module readings · current-reading SQL shape', () => {
  test('selects the latest reading per (fixture, module), FIXTURE subject only', () => {
    assert.match(CURRENT_FIXTURE_READINGS_SQL, /DISTINCT ON \(mr\.subject_fixture_id, mr\.module_definition_id\)/);
    assert.match(CURRENT_FIXTURE_READINGS_SQL, /ORDER BY[\s\S]*mr\.as_of DESC, mr\.calculated_at DESC, mr\.id DESC/);
    assert.match(CURRENT_FIXTURE_READINGS_SQL, /FROM module\.module_reading mr/);
    assert.match(CURRENT_FIXTURE_READINGS_SQL, /JOIN module\.module_definition md/);
    assert.match(CURRENT_FIXTURE_READINGS_SQL, /mr\.subject_kind_code = 'FIXTURE'/);
    assert.match(CURRENT_FIXTURE_READINGS_SQL, /mr\.subject_fixture_id = \$1::bigint/);
    assert.match(CURRENT_FIXTURE_READINGS_SQL, /mr\.subject_fixture_partition_on = \$2::date/);
    assert.match(CURRENT_FIXTURE_READINGS_SQL, /\$4::text\[\] IS NULL OR md\.module_key = ANY\(\$4::text\[\]\)/);
    // quarantine (035) exclusion, mirroring the TEAM reader
    assert.match(CURRENT_FIXTURE_READINGS_SQL, /NOT EXISTS[\s\S]*module_reading_quarantine/);
    // read-only
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(CURRENT_FIXTURE_READINGS_SQL));
  });

  test('TEMPORAL SAFETY: the SQL bounds as_of with an upper ceiling ($3) — never unbounded', () => {
    assert.match(CURRENT_FIXTURE_READINGS_SQL, /mr\.as_of <= \$3::timestamptz/);
  });

  test('mapFixtureReadingRow coerces numeric/bigint text and preserves nulls', () => {
    const r = mapFixtureReadingRow(sampleRow as any);
    assert.deepEqual(r, {
      moduleKey: 'form_gap_accuracy', fixtureId: '292', asOf: sampleRow.as_of, calculatedAt: sampleRow.calculated_at,
      moduleStatusCode: 'SUPPORTS', strength: null, confidence: null, sampleObservationCount: 6,
      sampleMeetsThreshold: true, verdictText: 'Home venue form stronger by 12.50.', inactiveReason: null,
    });
  });

  test('binds fixture id, partition, as_of ceiling, and the default module set', async () => {
    const { tx, calls } = captureTx([sampleRow]);
    const asOf = new Date('2026-08-23T19:00:00Z'); // the fixture kickoff (upper bound)
    const out = await readFixtureModuleReadings(tx, { fixtureId: '292', fixturePartitionOn: '2026-08-23', asOf });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, ['292', '2026-08-23', asOf, [...FIXTURE_MATCH_MODULE_KEYS]]);
    assert.equal(out.length, 1);
    assert.equal(out[0].moduleKey, 'form_gap_accuracy');
  });

  test('the default module set is exactly the three comparison modules', () => {
    assert.deepEqual([...FIXTURE_MATCH_MODULE_KEYS], ['form_gap_accuracy', 'rest_advantage', 'travel_impact']);
  });

  test('as_of is always bound as a param (the ceiling is required, never omitted)', async () => {
    const { tx, calls } = captureTx([]);
    const asOf = new Date('2026-08-23T19:00:00Z');
    await readFixtureModuleReadings(tx, { fixtureId: '1', fixturePartitionOn: '2026-08-23', asOf, moduleKeys: ['rest_advantage'] });
    assert.equal(calls[0].params[2], asOf, 'as_of ceiling is bound to $3');
    assert.deepEqual(calls[0].params[3], ['rest_advantage'], 'explicit module keys are honoured');
  });
});
