// TEAM READINESS read-model tests (DB-free, pure).
//
// Proves the governed-reading projection:
//   • a governed reading maps to status/strength/confidence/sample/verdict/asOf,
//     with NULL strength/confidence preserved (no fabricated score);
//   • asOf comes from the reading's as_of, NOT calculated_at;
//   • INACTIVE surfaces as status + inactiveReason (never converted to absence);
//   • no reading → readiness null, coverage 'absent', readinessIsGoverned true;
//   • evidence maps when present, null when absent;
//   • no numeric `score` field and no prediction/probability language leaks.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  mapReadinessReading, mapReadinessEvidence, buildTeamReadiness,
} from '../teamReadiness';
import type { TeamModuleReading } from '../../../module/read/readings';
import type { ReadingEvidence } from '../../../module/read/evidence';

function reading(over: Partial<TeamModuleReading> = {}): TeamModuleReading {
  return {
    moduleKey: 'readiness_tracker',
    teamId: '67',
    contextKindCode: 'ALL_COMPETITIONS',
    contextCompetitionEditionId: null,
    asOf: new Date('2026-07-17T23:00:00.000Z'),
    calculatedAt: new Date('2026-09-06T09:30:00.000Z'), // deliberately different from asOf
    moduleStatusCode: 'NEUTRAL',
    strength: null,
    confidence: null,
    sampleObservationCount: 10,
    sampleMeetsThreshold: true,
    verdictText: 'Steady form: last-five points minus prior-five is 0.',
    inactiveReason: null,
    ...over,
  };
}

const EVIDENCE: ReadingEvidence = {
  teamId: '67', moduleKey: 'readiness_tracker', contextKindCode: 'ALL_COMPETITIONS', contextCompetitionEditionId: null,
  declaredInputCount: 1, presentInputCount: 1, belowThresholdInputCount: 0, estimatedInputCount: 0,
  items: [{ featureKey: 'team.momentum', displayName: 'Momentum', value: 0, asOf: new Date('2026-07-17T23:00:00.000Z'), contributionDirection: 'NEUTRAL' }],
};

describe('mapReadinessReading', () => {
  test('maps status/sample/verdict; NULL strength/confidence preserved; asOf = as_of (not calculated_at)', () => {
    const r = mapReadinessReading(reading(), undefined);
    assert.equal(r.moduleKey, 'readiness_tracker');
    assert.equal(r.status, 'NEUTRAL');
    assert.equal(r.strength, null);
    assert.equal(r.confidence, null);
    assert.deepEqual(r.sample, { matches: 10, meetsThreshold: true });
    assert.equal(r.verdictText, 'Steady form: last-five points minus prior-five is 0.');
    assert.equal(r.inactiveReason, null);
    assert.equal(r.asOf, '2026-07-17T23:00:00.000Z');   // NOT the 2026-09-06 calculatedAt
    assert.equal(r.evidence, null);
  });

  test('a persisted magnitude passes through when present (future versions)', () => {
    const r = mapReadinessReading(reading({ strength: 42, confidence: 0.8, moduleStatusCode: 'SUPPORTS' }), undefined);
    assert.equal(r.strength, 42);
    assert.equal(r.confidence, 0.8);
    assert.equal(r.status, 'SUPPORTS');
  });

  test('INACTIVE surfaces as status + inactiveReason (not absence)', () => {
    const r = mapReadinessReading(reading({ moduleStatusCode: 'INACTIVE', verdictText: null, inactiveReason: 'team.momentum absent' }), undefined);
    assert.equal(r.status, 'INACTIVE');
    assert.equal(r.inactiveReason, 'team.momentum absent');
  });

  test('no fabricated numeric score field', () => {
    const r = mapReadinessReading(reading(), undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(r, 'score'), false);
  });
});

describe('mapReadinessEvidence', () => {
  test('undefined → null', () => {
    assert.equal(mapReadinessEvidence(undefined), null);
  });
  test('maps counts + items (item asOf → ISO)', () => {
    const e = mapReadinessEvidence(EVIDENCE)!;
    assert.equal(e.declaredInputCount, 1);
    assert.equal(e.presentInputCount, 1);
    assert.equal(e.items.length, 1);
    assert.equal(e.items[0].featureKey, 'team.momentum');
    assert.equal(e.items[0].asOf, '2026-07-17T23:00:00.000Z');
  });
  test('reading maps its evidence when supplied', () => {
    const r = mapReadinessReading(reading(), EVIDENCE);
    assert.notEqual(r.evidence, null);
    assert.equal(r.evidence!.declaredInputCount, 1);
  });
});

describe('buildTeamReadiness', () => {
  test('no reading → readiness null, coverage absent, governed flag true', () => {
    const out = buildTeamReadiness(undefined, undefined);
    assert.equal(out.readiness, null);
    assert.equal(out.coverage.readiness, 'absent');
    assert.equal(out.coverage.readinessIsGoverned, true);
  });

  test('reading present → coverage present + governed flag', () => {
    const out = buildTeamReadiness(reading(), EVIDENCE);
    assert.notEqual(out.readiness, null);
    assert.equal(out.coverage.readiness, 'present');
    assert.equal(out.coverage.readinessIsGoverned, true);
  });

  test('governance: projection contains no score/prediction/probability language', () => {
    const blob = JSON.stringify(buildTeamReadiness(reading(), EVIDENCE)).toLowerCase();
    for (const term of ['"score"', 'predicted', 'probability', 'recommend', 'bet']) {
      assert.equal(blob.includes(term), false, `readiness must not emit "${term}"`);
    }
  });
});
