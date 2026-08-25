// S-9B — MATCH_RESULT/1.0.0 derivation (DB-free). Regulation goals only.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveMatchResult,
  MATCH_RESULT_DIMENSION,
  MATCH_RESULT_DERIVATION_DESIGNATION,
} from '../outcome/deriveMatchResult';

describe('MATCH_RESULT/1.0.0 derivation (A1/A2)', () => {
  test('1. home_goals > away_goals → HOME_WIN', () => {
    assert.equal(deriveMatchResult(2, 1), 'HOME_WIN');
    assert.equal(deriveMatchResult(1, 0), 'HOME_WIN');
    assert.equal(deriveMatchResult(5, 0), 'HOME_WIN');
  });
  test('2. home_goals = away_goals → DRAW', () => {
    assert.equal(deriveMatchResult(0, 0), 'DRAW');
    assert.equal(deriveMatchResult(1, 1), 'DRAW');
    assert.equal(deriveMatchResult(3, 3), 'DRAW');
  });
  test('3. home_goals < away_goals → AWAY_WIN', () => {
    assert.equal(deriveMatchResult(0, 1), 'AWAY_WIN');
    assert.equal(deriveMatchResult(1, 4), 'AWAY_WIN');
  });

  test('A2: authoritative score is regulation only — a 1-1 draw won on penalties is still DRAW', () => {
    // The function accepts only regulation goals; AET/penalties are structurally not
    // inputs to 1.0.0. A tie decided by a shootout derives DRAW from regulation goals.
    assert.equal(deriveMatchResult(1, 1), 'DRAW');
  });

  test('constants name the governed dimension and version', () => {
    assert.equal(MATCH_RESULT_DIMENSION, 'MATCH_RESULT');
    assert.equal(MATCH_RESULT_DERIVATION_DESIGNATION, '1.0.0');
  });

  test('rejects non-integer or negative goals rather than fabricating an outcome', () => {
    assert.throws(() => deriveMatchResult(-1, 0), /non-negative integer/);
    assert.throws(() => deriveMatchResult(1.5, 0), /non-negative integer/);
    assert.throws(() => deriveMatchResult(0, Number.NaN), /non-negative integer/);
  });

  test('deterministic — identical inputs give an identical outcome', () => {
    assert.equal(deriveMatchResult(2, 1), deriveMatchResult(2, 1));
  });
});
