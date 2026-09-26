// GOVERNED BOOTSTRAP CLI tests (DB-free: injected deps + fixtures). No provider, no DB.
// Exercises the real executeBootstrap + executeEnrichmentJob composition with fakes.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseBootstrapArgs, splitIntoBatches, executeBootstrap, CALLS_PER_FIXTURE,
} from '../cli';
import type { PlannedFixture, EnrichmentExecutionDeps, FixtureEnrichmentOutcome } from '../enrichmentJob';
import type { ReservationDecision } from '../reservationStore';

function fx(id: number): PlannedFixture {
  return { fixtureId: String(id), fixturePartitionOn: 'p', fixtureProviderId: `prov-${id}`,
    kickoffAt: `2026-02-${(id % 28) + 1}T00:00:00Z`, homeTeamId: 'h', awayTeamId: 'a' };
}
function fixtures(n: number): PlannedFixture[] { return Array.from({ length: n }, (_, i) => fx(i + 1)); }

const admitted = (jobId: string, est: number): ReservationDecision => ({
  code: 'ADMITTED', admitted: true, reused: false, jobId, estimatedCalls: est,
  dailyQuota: 7600, actualUsedToday: 0, committed: 0, retryReserve: 0, available: 7600, shortfall: 0,
});
const rejected = (jobId: string, est: number): ReservationDecision => ({
  code: 'REJECTED_BUDGET', admitted: false, reused: false, jobId, estimatedCalls: est,
  dailyQuota: 7600, actualUsedToday: 7600, committed: 0, retryReserve: 0, available: 0, shortfall: est,
});

function fakeDeps(over: { admitFor?: (jobId: string) => ReservationDecision; perFixtureCalls?: number; hardStop?: (pid: string) => boolean } = {}) {
  const enriched: string[] = [];
  const admitted_jobs: string[] = [];
  const reconciled: { jobId: string; actual: number }[] = [];
  const deps: EnrichmentExecutionDeps = {
    admit: async (jobId, est) => { admitted_jobs.push(jobId); return over.admitFor ? over.admitFor(jobId) : admitted(jobId, est); },
    enrichFixture: async (pid): Promise<FixtureEnrichmentOutcome> => {
      enriched.push(pid);
      const hs = over.hardStop?.(pid) ?? false;
      return { fixtureProviderId: pid, providerCalls: over.perFixtureCalls ?? CALLS_PER_FIXTURE, runStatus: hs ? 'HARD_STOP' : 'SUCCEEDED' };
    },
    reconcile: async (jobId, actual) => { reconciled.push({ jobId, actual }); return true; },
  };
  return { deps, enriched, admitted_jobs, reconciled };
}

// ── args & batching ─────────────────────────────────────────────────────────────

describe('bootstrap · args & batching', () => {
  test('default is dry-run; --confirm opts into spend; no window flags exist (no historical leak)', () => {
    const a = parseBootstrapArgs([]);
    assert.equal(a.dryRun, true);
    assert.equal(a.confirm, false);
    const b = parseBootstrapArgs(['--confirm']);
    assert.equal(b.confirm, true);
    assert.equal(b.dryRun, false);
    // there is no --from/--to: the scope is the authorized editions, never a historical window
    assert.ok(!('from' in a) && !('to' in a));
  });
  test('--fixture-provider-id (and --fixture alias) select governed single-fixture mode', () => {
    assert.equal(parseBootstrapArgs([]).fixtureProviderId, undefined);
    assert.equal(parseBootstrapArgs(['--fixture-provider-id', '15237975']).fixtureProviderId, '15237975');
    assert.equal(parseBootstrapArgs(['--fixture', '15237975', '--confirm']).fixtureProviderId, '15237975');
    // single-fixture mode is orthogonal to the dry-run default
    assert.equal(parseBootstrapArgs(['--fixture', '15237975']).dryRun, true);
    assert.equal(parseBootstrapArgs(['--fixture', '15237975', '--confirm']).confirm, true);
  });
  test('CALLS_PER_FIXTURE = 2; batches respect batchSize and the max-calls cap', () => {
    assert.equal(CALLS_PER_FIXTURE, 2);
    const batches = splitIntoBatches(fixtures(10), 4, 1000);
    assert.deepEqual(batches.map((b) => b.length), [4, 4, 2]);
    // max-calls caps fixtures at floor(maxCalls/2): 6 calls → 3 fixtures
    const capped = splitIntoBatches(fixtures(10), 25, 6);
    assert.equal(capped.reduce((s, b) => s + b.length, 0), 3);
  });
  test('no fixture appears in two batches (no duplicate enrichment)', () => {
    const ids = splitIntoBatches(fixtures(10), 3, 1000).flat().map((f) => f.fixtureId);
    assert.equal(new Set(ids).size, ids.length);
  });
});

// ── dry run ───────────────────────────────────────────────────────────────────

describe('bootstrap · dry run', () => {
  test('confirm:false performs ZERO provider calls and no admission', async () => {
    const { deps, enriched, admitted_jobs, reconciled } = fakeDeps();
    const r = await executeBootstrap(fixtures(50), deps, { confirm: false, batchSize: 25, maxCalls: 1000, runId: 'run1' });
    assert.equal(r.dryRun, true);
    assert.equal(r.totalFixtures, 50);
    assert.equal(r.totalEstimatedCalls, 100); // 2 × 50
    assert.equal(enriched.length, 0);
    assert.equal(admitted_jobs.length, 0);
    assert.equal(reconciled.length, 0);
  });
});

// ── confirmed execution ─────────────────────────────────────────────────────────

describe('bootstrap · confirmed execution', () => {
  test('admits per batch (2×fixtures), enriches each, reconciles to ACTUAL', async () => {
    const { deps, enriched, admitted_jobs, reconciled } = fakeDeps();
    const r = await executeBootstrap(fixtures(5), deps, { confirm: true, batchSize: 2, maxCalls: 1000, runId: 'run1' });
    assert.equal(r.dryRun, false);
    assert.equal(r.batches, 3);                     // 2 + 2 + 1
    assert.deepEqual(admitted_jobs, ['bootstrap:run1:b0', 'bootstrap:run1:b1', 'bootstrap:run1:b2']); // deterministic + unique
    assert.equal(enriched.length, 5);               // each fixture enriched once
    assert.equal(r.actualCalls, 10);                // 5 × 2
    assert.equal(reconciled.length, 3);             // reconciled per batch, to actual
    assert.deepEqual(reconciled.map((x) => x.actual), [4, 4, 2]);
    assert.equal(r.stoppedEarly, false);
  });

  test('budget rejection on a batch stops the run (no partial spend beyond admitted)', async () => {
    // reject the 2nd batch (b1)
    const { deps, enriched } = fakeDeps({ admitFor: (jobId) => jobId.endsWith(':b1') ? rejected(jobId, 4) : admitted(jobId, 4) });
    const r = await executeBootstrap(fixtures(6), deps, { confirm: true, batchSize: 2, maxCalls: 1000, runId: 'run1' });
    assert.equal(r.stoppedEarly, true);
    assert.equal(enriched.length, 2);   // only batch b0's 2 fixtures were enriched; b1 rejected → stop
  });

  test('idempotent rerun: same runId → identical deterministic jobIds', async () => {
    const a = fakeDeps(); await executeBootstrap(fixtures(3), a.deps, { confirm: true, batchSize: 2, maxCalls: 1000, runId: 'R' });
    const b = fakeDeps(); await executeBootstrap(fixtures(3), b.deps, { confirm: true, batchSize: 2, maxCalls: 1000, runId: 'R' });
    assert.deepEqual(a.admitted_jobs, b.admitted_jobs); // same job_ids → admitAndReserve ON CONFLICT no-op on rerun
  });

  test('429/overrun accounting: actual > estimate is surfaced, reconciled to actual', async () => {
    // each fixture reports 3 calls (e.g. a retry/429) vs estimate 2
    const { deps, reconciled } = fakeDeps({ perFixtureCalls: 3 });
    const r = await executeBootstrap(fixtures(2), deps, { confirm: true, batchSize: 2, maxCalls: 1000, runId: 'run1' });
    assert.equal(r.actualCalls, 6);                 // 2 × 3 (measured)
    assert.equal(r.executed[0].overrun, true);      // 6 actual > 4 estimated
    assert.deepEqual(reconciled.map((x) => x.actual), [6]);
  });

  test('a hard-stopped fixture is counted and still reconciled by measured calls', async () => {
    const { deps } = fakeDeps({ hardStop: (pid) => pid === 'prov-2' });
    const r = await executeBootstrap(fixtures(2), deps, { confirm: true, batchSize: 2, maxCalls: 1000, runId: 'run1' });
    assert.equal(r.executed[0].succeeded, 1);
    assert.equal(r.executed[0].hardStopped, 1);
    assert.equal(r.actualCalls, 4); // both still counted by measured providerCalls
  });
});
