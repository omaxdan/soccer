// S-9B — ratified module characterized-outcome mapping (DB-free). Governance
// encoding for S-9C; performs NO scoring/calibration.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  characterizedOutcome,
  directionalBandCharacterizesDraw,
  hasRatifiedCharacterization,
} from '../characterizedOutcome';

for (const mod of ['rest_advantage', 'form_gap_accuracy']) {
  describe(`characterized outcome — ${mod} 1.0.0 (ratified S-9A)`, () => {
    test('15/17. SUPPORTS → DIRECTIONAL HOME_WIN', () => {
      assert.deepEqual(characterizedOutcome(mod, '1.0.0', 'SUPPORTS'), { kind: 'DIRECTIONAL', band: 'SUPPORTS', outcome: 'HOME_WIN' });
    });
    test('16/18. CONTRADICTS → DIRECTIONAL AWAY_WIN (specific opposite outcome)', () => {
      assert.deepEqual(characterizedOutcome(mod, '1.0.0', 'CONTRADICTS'), { kind: 'DIRECTIONAL', band: 'CONTRADICTS', outcome: 'AWAY_WIN' });
    });
    test('19. DRAW is FAILURE for both directional bands (neither band characterizes DRAW)', () => {
      assert.equal(directionalBandCharacterizesDraw(mod, '1.0.0'), false);
    });
    test('20. NEUTRAL → ABSTAIN (not a directional band)', () => {
      assert.deepEqual(characterizedOutcome(mod, '1.0.0', 'NEUTRAL'), { kind: 'ABSTAIN', band: 'NEUTRAL' });
    });
    test('21. INACTIVE → NOT_A_BAND (excluded)', () => {
      assert.deepEqual(characterizedOutcome(mod, '1.0.0', 'INACTIVE'), { kind: 'NOT_A_BAND' });
    });
    test('has a ratified characterization', () => {
      assert.equal(hasRatifiedCharacterization(mod, '1.0.0'), true);
    });
  });
}

describe('characterized outcome — unratified module versions', () => {
  test('an unratified module version has no characterization and must not be scored', () => {
    assert.equal(hasRatifiedCharacterization('rest_advantage', '9.9.9'), false);
    assert.throws(() => characterizedOutcome('rest_advantage', '9.9.9', 'SUPPORTS'), /ratification required/);
    assert.throws(() => characterizedOutcome('some_new_module', '1.0.0', 'CONTRADICTS'), /ratification required/);
  });
  test('NEUTRAL/INACTIVE resolve without a ratified directional mapping (status-level, module-agnostic)', () => {
    assert.deepEqual(characterizedOutcome('some_new_module', '1.0.0', 'NEUTRAL'), { kind: 'ABSTAIN', band: 'NEUTRAL' });
    assert.deepEqual(characterizedOutcome('some_new_module', '1.0.0', 'INACTIVE'), { kind: 'NOT_A_BAND' });
  });
});
