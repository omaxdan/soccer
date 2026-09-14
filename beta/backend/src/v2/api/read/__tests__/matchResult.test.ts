// MATCH RESULT read-model tests (DB-free, pure).
//
// Proves the evidence-honest scoreline projection:
//   • final score always present when a result exists; coerces numeric text
//   • an UNREPORTED phase (half-time / extra-time / penalties) is null — never a
//     fabricated 0-0; a real 0-0 phase (both sides present and zero) is kept
//   • confirmedAt maps to ISO or null
//   • no result row → result null, coverage 'absent' (never an invented scoreline)
//   • coverage marks the scoreline as observed evidence (no derived W/D/L / outcome)

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { mapResult, buildMatchResult, type ResultRow } from '../matchResult';

function row(over: Partial<ResultRow> = {}): ResultRow {
  return {
    home_goals: 1, away_goals: 1,
    home_goals_half_time: 0, away_goals_half_time: 1,
    home_goals_extra_time: null, away_goals_extra_time: null,
    home_penalties: null, away_penalties: null,
    confirmed_at: '2026-07-18T01:05:00.000Z',
    ...over,
  };
}

describe('mapResult', () => {
  test('null/undefined row → null (no result yet)', () => {
    assert.equal(mapResult(null), null);
    assert.equal(mapResult(undefined), null);
  });

  test('final present; half-time present; extra-time/penalties absent → null', () => {
    const r = mapResult(row())!;
    assert.deepEqual(r.final, { home: 1, away: 1 });
    assert.deepEqual(r.halfTime, { home: 0, away: 1 });
    assert.equal(r.extraTime, null);
    assert.equal(r.penalties, null);
    assert.equal(r.confirmedAt, '2026-07-18T01:05:00.000Z');
  });

  test('coerces numeric text and preserves a real 0-0 half-time (not treated as absent)', () => {
    const r = mapResult(row({ home_goals: '2', away_goals: '0', home_goals_half_time: '0', away_goals_half_time: '0' }))!;
    assert.deepEqual(r.final, { home: 2, away: 0 });
    assert.deepEqual(r.halfTime, { home: 0, away: 0 }); // a real, reported 0-0 — kept
  });

  test('a phase with only one side present is treated as unreported (null), never fabricated', () => {
    const r = mapResult(row({ home_goals_half_time: 1, away_goals_half_time: null }))!;
    assert.equal(r.halfTime, null);
  });

  test('penalties present maps through; confirmedAt null stays null', () => {
    const r = mapResult(row({ home_penalties: 4, away_penalties: 3, confirmed_at: null }))!;
    assert.deepEqual(r.penalties, { home: 4, away: 3 });
    assert.equal(r.confirmedAt, null);
  });
});

describe('buildMatchResult', () => {
  test('present result → coverage present, observed flag set', () => {
    const out = buildMatchResult(row());
    assert.notEqual(out.result, null);
    assert.equal(out.coverage.result, 'present');
    assert.equal(out.coverage.resultIsObserved, true);
  });

  test('no result row → result null, coverage absent (never fabricated)', () => {
    const out = buildMatchResult(null);
    assert.equal(out.result, null);
    assert.equal(out.coverage.result, 'absent');
    assert.equal(out.coverage.resultIsObserved, true);
  });

  test('projection carries no derived outcome / W-D-L / verdict language', () => {
    const blob = JSON.stringify(buildMatchResult(row())).toLowerCase();
    for (const term of ['outcome', 'verdict', 'winner', 'result_label', 'predicted', 'probability']) {
      assert.equal(blob.includes(term), false, `result must not emit "${term}"`);
    }
  });
});
