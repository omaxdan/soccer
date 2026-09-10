// ─────────────────────────────────────────────────────────────────────────────
// PRE-PEAK PLANNER TESTS — pure, deterministic. No DB, no provider, no clock.
// Proves the planner inherits Task-4 fail-closed semantics and never turns
// UNKNOWN demand/capacity/reserve into an ordinary ALLOW. No historical Task-3
// numbers are baked into the planner — tests supply their own inputs.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planPrePeak,
  classifyWindowCoverage,
  type PrePeakPlanInput,
  type EditionRequest,
  type CoveragePeriod,
} from '../prePeakPlanner';
import type { Capacity, RetryReserve } from '../budget';

const CONFIGURED_200: Capacity = { units: 200, provenance: 'CONFIGURED' };
const KNOWN_RESERVE: RetryReserve = { units: 5, source: 'MEASURED' };
const UNKNOWN_RESERVE: RetryReserve = { units: null, source: 'UNKNOWN' };
const WINDOW = { from: new Date('2027-01-20T00:00:00Z'), to: new Date('2027-01-24T00:00:00Z') };

// England 17=13, Austria 45=6, Germany 35=11 are MEASURED; Brazil 325 is UNKNOWN.
const EN: EditionRequest = { editionLabel: 'England', tournamentId: '17', coverageStatus: 'UNCOVERED' };
const AT: EditionRequest = { editionLabel: 'Austria', tournamentId: '45', coverageStatus: 'UNCOVERED' };
const DE: EditionRequest = { editionLabel: 'Germany', tournamentId: '35', coverageStatus: 'UNCOVERED' };
const BR: EditionRequest = { editionLabel: 'Brazil', tournamentId: '325', coverageStatus: 'UNCOVERED' };

function plan(overrides: Partial<PrePeakPlanInput>): ReturnType<typeof planPrePeak> {
  return planPrePeak({
    provider: 'SPORTSAPI_API',
    windowLabel: 'PRE-PEAK (reset semantics UNKNOWN)',
    window: WINDOW,
    priority: 'P1',
    editions: [EN, AT, DE],
    capacity: CONFIGURED_200,
    consumed: 0,
    retryReserve: KNOWN_RESERVE,
    latestQuotaRemaining: null,
    ...overrides,
  });
}

describe('classifyWindowCoverage · pure interval logic', () => {
  const period = (s: string, eExcl: string): CoveragePeriod => ({ start: new Date(s), endExclusive: new Date(eExcl) });

  test('fully covered → COVERED', () => {
    // request [2027-01-20 .. 2027-01-24] => half-open [01-20, 01-25)
    assert.equal(classifyWindowCoverage(WINDOW.from, WINDOW.to, [period('2027-01-01', '2027-02-01')]), 'COVERED');
  });
  test('no overlap → UNCOVERED', () => {
    assert.equal(classifyWindowCoverage(WINDOW.from, WINDOW.to, [period('2026-08-01', '2026-09-01')]), 'UNCOVERED');
    assert.equal(classifyWindowCoverage(WINDOW.from, WINDOW.to, []), 'UNCOVERED');
  });
  test('overlap short of full → PARTIAL', () => {
    assert.equal(classifyWindowCoverage(WINDOW.from, WINDOW.to, [period('2027-01-20', '2027-01-23')]), 'PARTIAL');
  });
  test('internal gap → PARTIAL (not COVERED)', () => {
    assert.equal(
      classifyWindowCoverage(WINDOW.from, WINDOW.to, [period('2027-01-20', '2027-01-22'), period('2027-01-23', '2027-01-25')]),
      'PARTIAL'
    );
  });
  test('two adjacent periods spanning the window merge to COVERED', () => {
    assert.equal(
      classifyWindowCoverage(WINDOW.from, WINDOW.to, [period('2027-01-20', '2027-01-23'), period('2027-01-23', '2027-01-25')]),
      'COVERED'
    );
  });
});

describe('planPrePeak · demand + fail-closed inheritance', () => {
  test('1. all measured demand + known capacity/reserve → normal ALLOW', () => {
    const p = plan({ editions: [EN, AT, DE] });
    assert.equal(p.assessment.decision, 'ALLOW');
    assert.equal(p.assessment.plannedCalls, 30); // 13+6+11
    assert.equal(p.unknownDemandEditions.length, 0);
  });

  test('2 & 3. Brazil (unknown cost) in the portfolio → UNKNOWN, not a numeric ALLOW', () => {
    const p = plan({ editions: [EN, AT, DE, BR] });
    assert.equal(p.assessment.decision, 'UNKNOWN');
    assert.equal(p.assessment.reasonCode, 'DEMAND_UNKNOWN');
    assert.equal(p.assessment.plannedCalls, null);
    assert.deepEqual(p.unknownDemandEditions, ['Brazil']);
    // The measured editions are still visible with their real costs.
    const en = p.editions.find((e) => e.editionLabel === 'England');
    assert.equal(en?.demand.estimatedCalls, 13);
    const br = p.editions.find((e) => e.editionLabel === 'Brazil');
    assert.equal(br?.demand.estimatedCalls, null);
    assert.equal(br?.basis, 'FULL_SWEEP_UNKNOWN_COST');
  });

  test('4. already-covered edition contributes 0, reducing demand correctly', () => {
    const coveredEN: EditionRequest = { ...EN, coverageStatus: 'COVERED' };
    const p = plan({ editions: [coveredEN, AT, DE] });
    const en = p.editions.find((e) => e.editionLabel === 'England');
    assert.equal(en?.demand.estimatedCalls, 0);
    assert.equal(en?.basis, 'ALREADY_COVERED');
    assert.equal(p.assessment.plannedCalls, 17); // 0 + 6 + 11
    assert.equal(p.assessment.decision, 'ALLOW');
  });

  test('4b. forceRefresh makes a covered edition demand its full measured sweep again', () => {
    const coveredEN: EditionRequest = { ...EN, coverageStatus: 'COVERED' };
    const p = plan({ editions: [coveredEN, AT, DE], forceRefresh: true });
    const en = p.editions.find((e) => e.editionLabel === 'England');
    assert.equal(en?.demand.estimatedCalls, 13);
    assert.equal(p.assessment.plannedCalls, 30);
  });

  test('5. partial coverage → UNKNOWN remaining demand (never invented), aggregate UNKNOWN', () => {
    const partialEN: EditionRequest = { ...EN, coverageStatus: 'PARTIAL' };
    const p = plan({ editions: [partialEN, AT, DE] });
    const en = p.editions.find((e) => e.editionLabel === 'England');
    assert.equal(en?.basis, 'PARTIAL_UNKNOWN');
    assert.equal(en?.demand.estimatedCalls, null);
    assert.equal(p.assessment.decision, 'UNKNOWN');
    assert.equal(p.assessment.reasonCode, 'DEMAND_UNKNOWN');
    assert.deepEqual(p.unknownDemandEditions, ['England']);
  });

  test('6. UNKNOWN capacity → UNKNOWN', () => {
    const p = plan({ capacity: { units: null, provenance: 'UNKNOWN' } });
    assert.equal(p.assessment.decision, 'UNKNOWN');
    assert.equal(p.assessment.reasonCode, 'CAPACITY_UNKNOWN');
    assert.equal(p.assessment.capacityVerified, false);
  });

  test('7. UNKNOWN retry reserve inherits Task-4 fail-closed behavior', () => {
    // P1 + unknown reserve → UNKNOWN (RESERVE_UNKNOWN); P3 → DEFER.
    const p1 = plan({ retryReserve: UNKNOWN_RESERVE, priority: 'P1' });
    assert.equal(p1.assessment.decision, 'UNKNOWN');
    assert.equal(p1.assessment.reasonCode, 'RESERVE_UNKNOWN');
    const p3 = plan({ retryReserve: UNKNOWN_RESERVE, priority: 'P3' });
    assert.equal(p3.assessment.decision, 'DEFER');
    assert.equal(p3.assessment.reasonCode, 'DEFER_RESERVE_UNKNOWN');
  });

  test('8. quota_remaining stays evidence only; never establishes VERIFIED capacity', () => {
    const p = plan({ latestQuotaRemaining: 87 });
    assert.equal(p.assessment.latestQuotaRemaining, 87);
    assert.equal(p.assessment.capacityProvenance, 'CONFIGURED');
    assert.equal(p.assessment.capacityVerified, false);
    assert.equal(p.assessment.capacityUnits, 200);
  });

  test('9. hard capacity exhaustion → BLOCK', () => {
    const p = plan({ consumed: 250, editions: [EN] });
    assert.equal(p.assessment.decision, 'BLOCK');
    assert.equal(p.assessment.reasonCode, 'CAPACITY_EXHAUSTED');
  });

  test('10. P1 emergency override only extends the exact Task-4 path (unknown reserve)', () => {
    const forced = plan({ retryReserve: UNKNOWN_RESERVE, priority: 'P1', emergencyOverride: true });
    assert.equal(forced.assessment.decision, 'ALLOW');
    assert.equal(forced.assessment.reasonCode, 'P1_EMERGENCY_OVERRIDE');
    // Override does NOT rescue P3, and does NOT defeat a hard BLOCK.
    const p3 = plan({ retryReserve: UNKNOWN_RESERVE, priority: 'P3', emergencyOverride: true });
    assert.equal(p3.assessment.decision, 'DEFER');
    const exhausted = plan({ consumed: 250, editions: [EN], priority: 'P1', emergencyOverride: true, retryReserve: UNKNOWN_RESERVE });
    assert.equal(exhausted.assessment.decision, 'BLOCK');
  });

  test('11. empty demand / all covered → ALLOW with zero planned calls, no invented demand', () => {
    const empty = plan({ editions: [] });
    assert.equal(empty.assessment.decision, 'ALLOW');
    assert.equal(empty.assessment.plannedCalls, 0);
    const allCovered = plan({
      editions: [{ ...EN, coverageStatus: 'COVERED' }, { ...AT, coverageStatus: 'COVERED' }],
    });
    assert.equal(allCovered.assessment.plannedCalls, 0);
    assert.equal(allCovered.assessment.decision, 'ALLOW');
    assert.equal(allCovered.assessment.reasonCode, 'NO_DEMAND');
  });

  test('12. planner needs no hard-coded Task-3 numbers — it reads supplied evidence', () => {
    // A single measured edition with a high consumed value yields INSUFFICIENT,
    // proving the decision comes from inputs, not baked constants.
    const p = plan({ editions: [EN], consumed: 195 }); // remaining 5 < 13
    assert.equal(p.assessment.decision, 'BLOCK');
    assert.equal(p.assessment.reasonCode, 'INSUFFICIENT_CAPACITY');
  });
});
