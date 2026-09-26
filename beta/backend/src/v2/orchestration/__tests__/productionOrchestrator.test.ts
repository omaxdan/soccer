// PRODUCTION ORCHESTRATOR tests (DB-free: injected stages + injected lock). No provider,
// no DB, no stage logic — pure sequencing, overlap, failure propagation, observability.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runProductionPipeline, STAGE_ORDER,
  type StageRunner, type StageName, type StageReport, type OrchestratorEvent,
} from '../productionOrchestrator';
import { parseOrchestratorArgs, assertRecurringWindow, buildStageRunners } from '../cli';
import { TRY_LOCK_SQL, UNLOCK_SQL, ORCHESTRATOR_LOCK_KEY } from '../overlapLock';

// a lock whose acquisition and release are observable
function fakeLock(acquired = true) {
  const calls = { released: 0 };
  return {
    calls,
    acquireLock: async () => ({ acquired, release: async () => { calls.released += 1; } }),
  };
}

// stage runners in the canonical order; `behavior` overrides a stage's report or throws
function stages(behavior: Partial<Record<StageName, () => Promise<StageReport>>> = {}) {
  const ran: StageName[] = [];
  const runners: StageRunner[] = STAGE_ORDER.map((name) => ({
    name,
    run: async () => {
      ran.push(name);
      const b = behavior[name];
      if (b) return b();
      return { ok: true };
    },
  }));
  return { runners, ran };
}

describe('orchestrator · sequencing & guards', () => {
  test('enforces the exact governed stage order', async () => {
    const bad = [...stages().runners].reverse();
    const lock = fakeLock();
    await assert.rejects(() => runProductionPipeline({ stages: bad, acquireLock: lock.acquireLock }), /must be exactly/);
  });

  test('happy path: all stages OK, in order, each run exactly once', async () => {
    const s = stages();
    const lock = fakeLock();
    const res = await runProductionPipeline({ stages: s.runners, acquireLock: lock.acquireLock, runId: 'r1' });
    assert.equal(res.status, 'COMPLETED');
    assert.deepEqual(s.ran, [...STAGE_ORDER]);            // order preserved, no duplicates
    assert.equal(new Set(s.ran).size, s.ran.length);
    assert.equal(res.stages.every((x) => x.status === 'OK'), true);
    assert.equal(lock.calls.released, 1);                  // released after success
  });
});

describe('orchestrator · overlap', () => {
  test('second concurrent invocation → ALREADY_RUNNING, no stage runs', async () => {
    const s = stages();
    const lock = fakeLock(false);
    const res = await runProductionPipeline({ stages: s.runners, acquireLock: lock.acquireLock });
    assert.equal(res.status, 'ALREADY_RUNNING');
    assert.equal(s.ran.length, 0);          // nothing ran → no double provider spend
    assert.equal(lock.calls.released, 0);   // nothing to release (never acquired)
  });
});

describe('orchestrator · failure propagation', () => {
  test('ingestion hard-fail → all downstream SKIPPED; run FAILED; lock released', async () => {
    const s = stages({ INGESTION: async () => ({ ok: false, detail: 'boom' }) });
    const lock = fakeLock();
    const res = await runProductionPipeline({ stages: s.runners, acquireLock: lock.acquireLock });
    assert.equal(res.status, 'FAILED');
    assert.equal(res.failureStage, 'INGESTION');
    assert.deepEqual(s.ran, ['INGESTION']);                          // downstream never invoked
    assert.deepEqual(res.stages.map((x) => x.status), ['FAILED', 'SKIPPED', 'SKIPPED', 'SKIPPED', 'SKIPPED', 'SKIPPED']);
    assert.equal(lock.calls.released, 1);                            // released after failure
  });

  test('mid-pipeline fail (MODULES) → SNAPSHOT/ACCRUAL skipped, upstream OK', async () => {
    const s = stages({ MODULES: async () => ({ ok: false }) });
    const res = await runProductionPipeline({ stages: s.runners, acquireLock: fakeLock().acquireLock });
    assert.deepEqual(s.ran, ['INGESTION', 'ENRICHMENT', 'FEATURES', 'MODULES']);
    assert.equal(res.failureStage, 'MODULES');
    assert.deepEqual(res.stages.map((x) => x.status), ['OK', 'OK', 'OK', 'FAILED', 'SKIPPED', 'SKIPPED']);
  });

  test('a thrown stage becomes a hard failure and releases the lock', async () => {
    const s = stages({ FEATURES: async () => { throw new Error('kaboom'); } });
    const lock = fakeLock();
    const res = await runProductionPipeline({ stages: s.runners, acquireLock: lock.acquireLock });
    assert.equal(res.status, 'FAILED');
    assert.equal(res.failureStage, 'FEATURES');
    assert.equal(lock.calls.released, 1);
  });
});

describe('orchestrator · budget & partial-failure semantics', () => {
  test('BUDGET_BLOCKED on ingestion is recorded but NON-fatal — downstream still runs', async () => {
    const s = stages({ INGESTION: async () => ({ ok: true, blocked: true, detail: 'no quota' }) });
    const res = await runProductionPipeline({ stages: s.runners, acquireLock: fakeLock().acquireLock });
    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.budgetBlocked, true);
    assert.equal(res.stages[0].status, 'BUDGET_BLOCKED');
    assert.deepEqual(s.ran, [...STAGE_ORDER]);   // provider-free downstream still executes
  });

  test('per-item failures (ok:true with failures>0) do NOT block downstream', async () => {
    const s = stages({ FEATURES: async () => ({ ok: true, detail: { failures: 3 } }) });
    const res = await runProductionPipeline({ stages: s.runners, acquireLock: fakeLock().acquireLock });
    assert.equal(res.status, 'COMPLETED');
    assert.equal(res.stages[2].status, 'OK');    // FEATURES (index 2 after INGESTION, ENRICHMENT) isolated its item failures
    assert.deepEqual(s.ran, [...STAGE_ORDER]);
  });

  test('deterministic: identical inputs → identical status/order (idempotent rerun)', async () => {
    const a = await runProductionPipeline({ stages: stages().runners, acquireLock: fakeLock().acquireLock, runId: 'x', clock: () => new Date('2026-09-26T00:00:00Z') });
    const b = await runProductionPipeline({ stages: stages().runners, acquireLock: fakeLock().acquireLock, runId: 'x', clock: () => new Date('2026-09-26T00:00:00Z') });
    assert.deepEqual(a.stages.map((s) => [s.stage, s.status]), b.stages.map((s) => [s.stage, s.status]));
  });
});

describe('orchestrator · observability', () => {
  test('emits start / per-stage / complete events', async () => {
    const events: OrchestratorEvent['type'][] = [];
    await runProductionPipeline({ stages: stages().runners, acquireLock: fakeLock().acquireLock, log: (e) => events.push(e.type) });
    assert.equal(events[0], 'ORCHESTRATION_START');
    assert.equal(events.at(-1), 'ORCHESTRATION_COMPLETE');
    assert.equal(events.filter((t) => t === 'STAGE_SUCCESS').length, STAGE_ORDER.length);
  });
});

describe('orchestrator · recurring-window guard (historical bootstrap excluded)', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  test('default window is a small current/forward span, bounded budget', () => {
    const args = parseOrchestratorArgs([], now);
    assert.ok(args.from.getTime() < now.getTime() && args.to.getTime() > now.getTime());
    assert.ok(args.maxCalls > 0 && args.maxCalls < 200); // never assumes the 7,500 key
  });
  test('rejects a wide (historical-shaped) window', () => {
    assert.throws(() => parseOrchestratorArgs(['--from', '2026-01-01', '--to', '2026-09-01'], now), /historical bootstrap/);
  });
  test('rejects a far-past from-date', () => {
    assert.throws(() => assertRecurringWindow(new Date('2026-01-01T00:00:00Z'), new Date('2026-01-05T00:00:00Z'), now), /past/);
  });
  test('accepts a normal recurring window', () => {
    assert.doesNotThrow(() => assertRecurringWindow(new Date('2026-09-25T00:00:00Z'), new Date('2026-09-29T00:00:00Z'), now));
  });
});

describe('orchestrator · production wiring shape', () => {
  test('buildStageRunners produces exactly the governed order', () => {
    const runners = buildStageRunners({ from: new Date(), to: new Date(), maxCalls: 100, dryRun: true });
    assert.deepEqual(runners.map((r) => r.name), [...STAGE_ORDER]);
  });
  test('overlap lock SQL is advisory + keyed; unlock present', () => {
    assert.match(TRY_LOCK_SQL, /pg_try_advisory_lock\(hashtext\(\$1::text\)\)/);
    assert.match(UNLOCK_SQL, /pg_advisory_unlock\(hashtext\(\$1::text\)\)/);
    assert.equal(ORCHESTRATOR_LOCK_KEY, 'pt_v2_production_orchestrator');
  });
});
