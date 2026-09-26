// RECURRING ENRICHMENT tests (DB-free: injected deps + fixtures). No provider, no DB.
// Exercises the real runRecurringEnrichment + selectRecurringFixtures composition, and the
// orchestrator ordering invariant (ENRICHMENT after the feed, before FEATURES).

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runRecurringEnrichment, selectRecurringFixtures, RECURRING_ENRICHMENT_HORIZON_DAYS,
  type RecurringEnrichmentDeps,
} from '../recurring';
import type { PlannedFixture, FixtureEnrichmentOutcome } from '../enrichmentJob';
import type { ReservationDecision } from '../reservationStore';
import { STAGE_ORDER } from '../../../orchestration/productionOrchestrator';

const ASOF = new Date('2026-09-26T12:00:00.000Z');
const DAY = 86_400_000;

function fx(id: number, daysAgo = 1): PlannedFixture {
  return {
    fixtureId: String(id), fixturePartitionOn: 'p', fixtureProviderId: `prov-${id}`,
    kickoffAt: new Date(ASOF.getTime() - daysAgo * DAY).toISOString(), homeTeamId: 'h', awayTeamId: 'a',
  };
}

const admitted = (jobId: string, est: number): ReservationDecision => ({
  code: 'ADMITTED', admitted: true, reused: false, jobId, estimatedCalls: est,
  dailyQuota: 7600, actualUsedToday: 0, committed: 0, retryReserve: 0, available: 7600, shortfall: 0,
});
const rejected = (jobId: string, est: number): ReservationDecision => ({
  code: 'REJECTED_BUDGET', admitted: false, reused: false, jobId, estimatedCalls: est,
  dailyQuota: 7600, actualUsedToday: 7600, committed: 0, retryReserve: 0, available: 0, shortfall: est,
});

function fakeDeps(over: {
  selection?: PlannedFixture[];
  admit?: (jobId: string, est: number) => ReservationDecision;
  hardStop?: (pid: string) => boolean;
} = {}) {
  const calls = { loads: 0, admits: [] as string[], enriched: [] as string[], reconciled: [] as { jobId: string; actual: number }[] };
  const deps: RecurringEnrichmentDeps = {
    loadSelection: async () => { calls.loads += 1; return over.selection ?? [fx(1)]; },
    admit: async (jobId, est) => { calls.admits.push(jobId); return (over.admit ?? admitted)(jobId, est); },
    enrichFixture: async (pid): Promise<FixtureEnrichmentOutcome> => {
      calls.enriched.push(pid);
      const hs = over.hardStop?.(pid) ?? false;
      return { fixtureProviderId: pid, providerCalls: 2, runStatus: hs ? 'HARD_STOP' : 'SUCCEEDED' };
    },
    reconcile: async (jobId, actual) => { calls.reconciled.push({ jobId, actual }); return true; },
  };
  return { deps, calls };
}

// ── selectRecurringFixtures (incremental guard) ────────────────────────────────

describe('selectRecurringFixtures — incremental by construction', () => {
  test('no fixtures → nothing selected', () => {
    assert.deepEqual(selectRecurringFixtures([], { asOf: ASOF, maxCalls: 150 }), []);
  });

  test('excludes fixtures older than the maintenance horizon (historical corpus never re-enters)', () => {
    const recent = fx(1, 2);                                  // 2 days ago → in
    const old = fx(2, RECURRING_ENRICHMENT_HORIZON_DAYS + 10); // well past horizon → out
    const out = selectRecurringFixtures([recent, old], { asOf: ASOF, maxCalls: 150 });
    assert.deepEqual(out.map((f) => f.fixtureId), ['1']);
  });

  test('caps to the call budget (floor(maxCalls/2) fixtures), freshest first', () => {
    const fixtures = [fx(1, 5), fx(2, 1), fx(3, 3)];           // kickoffs 5d, 1d, 3d ago
    const out = selectRecurringFixtures(fixtures, { asOf: ASOF, maxCalls: 4 }); // → 2 fixtures
    assert.equal(out.length, 2);
    assert.deepEqual(out.map((f) => f.fixtureId), ['2', '3']); // freshest (1d) then (3d); the 5d one is dropped
  });
});

// ── runRecurringEnrichment (governed execution) ────────────────────────────────

describe('runRecurringEnrichment', () => {
  test('no newly completed fixtures → zero calls, no admission, no enrichment', async () => {
    const { deps, calls } = fakeDeps({ selection: [] });
    const r = await runRecurringEnrichment({ maxCalls: 150, asOf: ASOF }, deps);
    assert.deepEqual(r, { selected: 0, callsSpent: 0, succeeded: 0, failed: 0, budgetBlocked: false });
    assert.equal(calls.admits.length, 0);
    assert.equal(calls.enriched.length, 0);
  });

  test('one fixture → governed demand of exactly 2 calls, admitted, enriched, reconciled to actual', async () => {
    const { deps, calls } = fakeDeps({ selection: [fx(1)] });
    const r = await runRecurringEnrichment({ maxCalls: 150, asOf: ASOF }, deps);
    assert.equal(r.selected, 1);
    assert.equal(calls.admits.length, 1);                     // NEVER bypasses the governor
    assert.deepEqual(calls.enriched, ['prov-1']);
    assert.equal(r.callsSpent, 2);
    assert.equal(r.succeeded, 1);
    assert.equal(calls.reconciled[0].actual, 2);              // reconciled to measured spend
    assert.equal(r.budgetBlocked, false);
  });

  test('multiple fixtures → bounded demand, all admitted under one reservation', async () => {
    const { deps, calls } = fakeDeps({ selection: [fx(1), fx(2), fx(3)] });
    const r = await runRecurringEnrichment({ maxCalls: 150, asOf: ASOF }, deps);
    assert.equal(r.selected, 3);
    assert.equal(calls.admits.length, 1);                     // one durable reservation for the batch
    assert.equal(r.callsSpent, 6);                            // 3 × 2
    assert.equal(r.succeeded, 3);
  });

  test('budget rejection enriches NOTHING and reports budgetBlocked (non-fatal)', async () => {
    const { deps, calls } = fakeDeps({ selection: [fx(1), fx(2)], admit: rejected });
    const r = await runRecurringEnrichment({ maxCalls: 150, asOf: ASOF }, deps);
    assert.equal(r.budgetBlocked, true);
    assert.equal(calls.enriched.length, 0);                   // all-or-nothing admission
    assert.equal(r.callsSpent, 0);
  });

  test('a single fixture failure is ISOLATED (HARD_STOP counted), others still enriched', async () => {
    const { deps, calls } = fakeDeps({ selection: [fx(1), fx(2), fx(3)], hardStop: (pid) => pid === 'prov-2' });
    const r = await runRecurringEnrichment({ maxCalls: 150, asOf: ASOF }, deps);
    assert.equal(calls.enriched.length, 3);                   // all attempted; the failure did not abort the loop
    assert.equal(r.succeeded, 2);
    assert.equal(r.failed, 1);
    assert.equal(r.callsSpent, 6);                            // measured spend still counted
  });

  test('retry semantics: a fixture still missing demand next run is re-selected and re-enriched', async () => {
    // Run 1: fixture 1 hard-stops → stays as demand. Run 2: loadSelection still returns it → retried.
    const first = fakeDeps({ selection: [fx(1)], hardStop: () => true });
    const r1 = await runRecurringEnrichment({ maxCalls: 150, asOf: ASOF }, first.deps);
    assert.equal(r1.failed, 1);
    const second = fakeDeps({ selection: [fx(1)] }); // demand persists (still missing), now succeeds
    const r2 = await runRecurringEnrichment({ maxCalls: 150, asOf: ASOF }, second.deps);
    assert.equal(r2.succeeded, 1);
    assert.deepEqual(second.calls.enriched, ['prov-1']);
  });

  test('idempotent: once enriched it drops from demand → next run is a clean no-op', async () => {
    const { deps, calls } = fakeDeps({ selection: [] }); // simulates a corpus with no missing coverage
    const r = await runRecurringEnrichment({ maxCalls: 150, asOf: ASOF }, deps);
    assert.equal(r.selected, 0);
    assert.equal(calls.enriched.length, 0);
  });
});

// ── orchestrator ordering invariant (raw enrichment → features → snapshot) ──────

describe('recurring enrichment · pipeline order', () => {
  test('ENRICHMENT runs after the feed (INGESTION) and before FEATURES/MODULES/SNAPSHOT', () => {
    const i = STAGE_ORDER.indexOf('INGESTION');
    const e = STAGE_ORDER.indexOf('ENRICHMENT');
    const f = STAGE_ORDER.indexOf('FEATURES');
    const s = STAGE_ORDER.indexOf('SNAPSHOT');
    assert.ok(i >= 0 && e >= 0 && f >= 0 && s >= 0);
    assert.ok(i < e, 'feed marks fixtures COMPLETED before enrichment reads demand');
    assert.ok(e < f, 'features consume the freshly enriched history in the same run');
    assert.ok(f < s, 'snapshot seals only after features/modules — sealed history is never rewritten here');
  });
});
