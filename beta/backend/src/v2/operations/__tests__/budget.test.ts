// ─────────────────────────────────────────────────────────────────────────────
// BUDGET GOVERNOR TESTS — pure decision function + accounting helpers.
// No DB, no provider, no clock. Every input supplied; every branch pinned.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  assessBudget,
  estimateEditionSweep,
  summariseUsage,
  deriveRetryReserve,
  MEASURED_SWEEP_CALLS,
  type BudgetAssessmentInput,
  type Capacity,
  type EditionDemand,
  type RetryReserve,
  type ApiUsageRow,
} from '../budget';

const CONFIGURED_200: Capacity = { units: 200, provenance: 'CONFIGURED' };
const KNOWN_RESERVE: RetryReserve = { units: 5, source: 'MEASURED' };
const UNKNOWN_RESERVE: RetryReserve = { units: null, source: 'UNKNOWN' };

function demand(...calls: (number | null)[]): EditionDemand[] {
  return calls.map((c, i) => ({
    editionLabel: `ed${i}`,
    endpointTier: 'FEED',
    estimatedCalls: c,
    confidence: c === null ? 'UNKNOWN' : 'MEASURED',
  }));
}

function input(overrides: Partial<BudgetAssessmentInput>): BudgetAssessmentInput {
  return {
    provider: 'SPORTSAPI_API',
    windowLabel: 'CONFIGURED-WINDOW (reset semantics UNKNOWN)',
    capacity: CONFIGURED_200,
    consumed: 0,
    latestQuotaRemaining: null,
    retryReserve: KNOWN_RESERVE,
    demand: demand(13),
    priority: 'P1',
    ...overrides,
  };
}

describe('assessBudget · decision table', () => {
  test('known capacity + low demand → ALLOW/FITS', () => {
    const a = assessBudget(input({ demand: demand(13, 6, 11) })); // 30 of 200
    assert.equal(a.decision, 'ALLOW');
    assert.equal(a.reasonCode, 'FITS');
    assert.equal(a.plannedCalls, 30);
    assert.equal(a.remaining, 200);
    assert.equal(a.effectiveRemaining, 195);
  });

  test('zero demand → ALLOW/NO_DEMAND (even with weird capacity)', () => {
    const a = assessBudget(input({ demand: [], capacity: { units: null, provenance: 'UNKNOWN' } }));
    assert.equal(a.decision, 'ALLOW');
    assert.equal(a.reasonCode, 'NO_DEMAND');
  });

  test('exhausted known capacity → BLOCK/CAPACITY_EXHAUSTED, remaining never negative', () => {
    const a = assessBudget(input({ consumed: 250, demand: demand(1) })); // consumed > capacity
    assert.equal(a.decision, 'BLOCK');
    assert.equal(a.reasonCode, 'CAPACITY_EXHAUSTED');
    assert.equal(a.remaining, 0, 'remaining is clamped at 0, never negative');
  });

  test('planned exceeds remaining → BLOCK/INSUFFICIENT_CAPACITY', () => {
    const a = assessBudget(input({ consumed: 190, demand: demand(20) })); // remaining 10 < 20
    assert.equal(a.decision, 'BLOCK');
    assert.equal(a.reasonCode, 'INSUFFICIENT_CAPACITY');
  });

  test('unknown capacity → UNKNOWN/CAPACITY_UNKNOWN, never claims verified', () => {
    const a = assessBudget(input({ capacity: { units: null, provenance: 'UNKNOWN' }, demand: demand(13) }));
    assert.equal(a.decision, 'UNKNOWN');
    assert.equal(a.reasonCode, 'CAPACITY_UNKNOWN');
    assert.equal(a.capacityVerified, false);
  });

  test('unknown demand cost → UNKNOWN/DEMAND_UNKNOWN, never ALLOW', () => {
    const a = assessBudget(input({ demand: demand(13, null, 11) }));
    assert.equal(a.decision, 'UNKNOWN');
    assert.equal(a.reasonCode, 'DEMAND_UNKNOWN');
    assert.equal(a.plannedCalls, null);
    assert.equal(a.demandConfidence, 'UNKNOWN');
  });

  test('CONFIGURED capacity is never relabelled VERIFIED', () => {
    const a = assessBudget(input({}));
    assert.equal(a.capacityProvenance, 'CONFIGURED');
    assert.equal(a.capacityVerified, false);
    const v = assessBudget(input({ capacity: { units: 200, provenance: 'VERIFIED' } }));
    assert.equal(v.capacityVerified, true);
  });

  test('reserve-intrusion zone: P1 → ALLOW/PRIORITY_RESERVE_OVERRIDE, P3 → DEFER/DEFER_RESERVE', () => {
    // remaining 10, reserve 5 → effective 5; planned 8 fits remaining but eats reserve.
    const base = { consumed: 190, retryReserve: KNOWN_RESERVE, demand: demand(8) };
    const p1 = assessBudget(input({ ...base, priority: 'P1' }));
    assert.equal(p1.decision, 'ALLOW');
    assert.equal(p1.reasonCode, 'PRIORITY_RESERVE_OVERRIDE');
    const p3 = assessBudget(input({ ...base, priority: 'P3' }));
    assert.equal(p3.decision, 'DEFER');
    assert.equal(p3.reasonCode, 'DEFER_RESERVE');
    const p2 = assessBudget(input({ ...base, priority: 'P2' }));
    assert.equal(p2.decision, 'DEFER');
  });

  test('UNKNOWN retry reserve NEVER becomes an ordinary ALLOW (fail closed), and is not treated as 0', () => {
    // P1 with ample nominal headroom (13 of 200) — must NOT be ordinary ALLOW.
    const p1 = assessBudget(input({ priority: 'P1', retryReserve: UNKNOWN_RESERVE, demand: demand(13) }));
    assert.equal(p1.decision, 'UNKNOWN');
    assert.equal(p1.reasonCode, 'RESERVE_UNKNOWN');
    assert.equal(p1.retryReserveKnown, false);
    assert.equal(p1.retryReserveUnits, null);
    assert.equal(p1.effectiveRemaining, null, 'unknown reserve is not rendered as spendable headroom');

    // P2 and P3 with the same ample headroom → DEFER, never ALLOW.
    const p2 = assessBudget(input({ priority: 'P2', retryReserve: UNKNOWN_RESERVE, demand: demand(13) }));
    assert.equal(p2.decision, 'DEFER');
    assert.equal(p2.reasonCode, 'DEFER_RESERVE_UNKNOWN');
    const p3 = assessBudget(input({ priority: 'P3', retryReserve: UNKNOWN_RESERVE, demand: demand(13) }));
    assert.equal(p3.decision, 'DEFER');
    assert.equal(p3.reasonCode, 'DEFER_RESERVE_UNKNOWN');
  });

  test('P1 + UNKNOWN reserve reaches ALLOW ONLY via an explicit emergency override', () => {
    const forced = assessBudget(input({
      priority: 'P1', retryReserve: UNKNOWN_RESERVE, demand: demand(13), emergencyOverride: true,
    }));
    assert.equal(forced.decision, 'ALLOW');
    assert.equal(forced.reasonCode, 'P1_EMERGENCY_OVERRIDE');
    // The override does NOT apply to P2/P3 — those still DEFER.
    const p2 = assessBudget(input({
      priority: 'P2', retryReserve: UNKNOWN_RESERVE, demand: demand(13), emergencyOverride: true,
    }));
    assert.equal(p2.decision, 'DEFER');
  });

  test('UNKNOWN reserve does not override a hard capacity BLOCK', () => {
    // Exhausted capacity BLOCKs regardless of reserve or override.
    const exhausted = assessBudget(input({
      consumed: 250, retryReserve: UNKNOWN_RESERVE, demand: demand(1), priority: 'P1', emergencyOverride: true,
    }));
    assert.equal(exhausted.decision, 'BLOCK');
    assert.equal(exhausted.reasonCode, 'CAPACITY_EXHAUSTED');
    // Over-capacity BLOCKs before the reserve gate too.
    const over = assessBudget(input({
      consumed: 190, retryReserve: UNKNOWN_RESERVE, demand: demand(20), priority: 'P1', emergencyOverride: true,
    }));
    assert.equal(over.decision, 'BLOCK');
    assert.equal(over.reasonCode, 'INSUFFICIENT_CAPACITY');
  });

  test('zero demand is ALLOW even with UNKNOWN reserve (nothing is spent)', () => {
    const a = assessBudget(input({ demand: [], retryReserve: UNKNOWN_RESERVE, priority: 'P1' }));
    assert.equal(a.decision, 'ALLOW');
    assert.equal(a.reasonCode, 'NO_DEMAND');
  });

  test('multiple editions: all measured sum; any unknown poisons the total to DEMAND_UNKNOWN', () => {
    const ok = assessBudget(input({ demand: demand(13, 6, 11) }));
    assert.equal(ok.plannedCalls, 30);
    const poisoned = assessBudget(input({ demand: demand(13, 6, 11, null) }));
    assert.equal(poisoned.decision, 'UNKNOWN');
    assert.equal(poisoned.reasonCode, 'DEMAND_UNKNOWN');
  });

  test('latest quota_remaining is carried as evidence only, not turned into capacity', () => {
    const a = assessBudget(input({ latestQuotaRemaining: 87, demand: demand(13) }));
    assert.equal(a.latestQuotaRemaining, 87);
    assert.equal(a.capacityUnits, 200); // still CONFIGURED, not replaced by the header
    assert.equal(a.capacityProvenance, 'CONFIGURED');
  });
});

describe('estimateEditionSweep · measured vs unknown', () => {
  test('England/Austria/Germany are MEASURED; Brazil is UNKNOWN (never invented)', () => {
    assert.deepEqual(estimateEditionSweep('17', 'England'), { editionLabel: 'England', endpointTier: 'FEED', estimatedCalls: 13, confidence: 'MEASURED' });
    assert.deepEqual(estimateEditionSweep('45', 'Austria'), { editionLabel: 'Austria', endpointTier: 'FEED', estimatedCalls: 6, confidence: 'MEASURED' });
    assert.deepEqual(estimateEditionSweep('35', 'Germany'), { editionLabel: 'Germany', endpointTier: 'FEED', estimatedCalls: 11, confidence: 'MEASURED' });
    const brazil = estimateEditionSweep('325', 'Brazil');
    assert.equal(brazil.estimatedCalls, null);
    assert.equal(brazil.confidence, 'UNKNOWN');
    assert.equal(MEASURED_SWEEP_CALLS['325'], undefined, 'Brazil must not have an invented cost');
  });

  test('a whole-portfolio refresh including Brazil is DEMAND_UNKNOWN, not an unsafe ALLOW', () => {
    const a = assessBudget(input({
      demand: [
        estimateEditionSweep('17', 'England'),
        estimateEditionSweep('45', 'Austria'),
        estimateEditionSweep('35', 'Germany'),
        estimateEditionSweep('325', 'Brazil'),
      ],
    }));
    assert.equal(a.decision, 'UNKNOWN');
    assert.equal(a.reasonCode, 'DEMAND_UNKNOWN');
  });
});

describe('summariseUsage + deriveRetryReserve · accounting', () => {
  const row = (occurredAt: string, requests: number, consumed: number, remaining: number | null, throttled: number): ApiUsageRow => ({
    occurredAt: new Date(occurredAt), requestsMade: requests, quotaConsumed: consumed, quotaRemaining: remaining, throttledCount: throttled,
  });

  test('empty ledger → zeros, no remaining, reserve UNKNOWN', () => {
    const s = summariseUsage([]);
    assert.deepEqual(s, { actualCalls: 0, quotaConsumed: 0, throttledTotal: 0, latestQuotaRemaining: null, windowCount: 0 });
    assert.deepEqual(deriveRetryReserve(s), { units: null, source: 'UNKNOWN' });
  });

  test('sums calls/consumed/throttled and takes the most-recent non-null remaining', () => {
    const s = summariseUsage([
      row('2026-09-10T09:00:00Z', 5, 5, 95, 0),
      row('2026-09-10T09:05:00Z', 3, 3, null, 1), // remaining absent — ignored for latest
      row('2026-09-10T09:10:00Z', 2, 2, 90, 2),
    ]);
    assert.equal(s.actualCalls, 10);
    assert.equal(s.quotaConsumed, 10);
    assert.equal(s.throttledTotal, 3);
    assert.equal(s.latestQuotaRemaining, 90, 'latest non-null remaining, by occurred_at');
    assert.equal(s.windowCount, 3);
  });

  test('retry reserve is the empirical throttled total when there is evidence', () => {
    const s = summariseUsage([row('2026-09-10T09:00:00Z', 5, 5, 95, 4)]);
    assert.deepEqual(deriveRetryReserve(s), { units: 4, source: 'MEASURED' });
  });
});
