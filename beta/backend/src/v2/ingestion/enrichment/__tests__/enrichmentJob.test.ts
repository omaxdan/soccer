// GOVERNED ENRICHMENT JOB tests (DB-free): dry-run planning spends/writes nothing;
// admitted execution is all-or-nothing, one-fixture-one-call, reconciled to ACTUAL usage.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  planEnrichmentJob, executeEnrichmentJob, defaultJobId, RESOLVE_PROVIDER_IDS_SQL,
  type EnrichmentJobPlan, type FixtureEnrichmentOutcome, type EnrichmentExecutionDeps,
} from '../enrichmentJob';
import type { ReservationDecision } from '../reservationStore';

const CONFIG = { keys: ['k1', 'k2'], dailyQuotaPerKey: 100, minRequestIntervalMs: 2000 } as any; // 200/day
const ASOF = new Date('2026-09-21T10:00:00Z');

function captureTx(queue: unknown[][]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let i = 0;
  const tx = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const rows = queue[i++] ?? [];
      return { rows, rowCount: rows.length };
    },
  } as unknown as PoolClient;
  return { tx, calls };
}

// readEditionEnrichmentDemand issues: counts, missing, perTeam, allTeams (4);
// then plan issues: resolve, committed, used (3).
function planQueue(opts: {
  completed: number; covered: number; missing: Array<{ id: string; k: string; h: string; a: string }>;
  perTeam: Array<{ team: string; covered: number }>; allTeams: string[];
  resolve: Array<{ id: string; pid: string }>; committed: number; used: number;
}) {
  return [
    [{ completed: String(opts.completed), covered: String(opts.covered) }],
    opts.missing.map((m) => ({ fixture_id: m.id, fixture_partition_on: 'p', kickoff_at: m.k, home_team_id: m.h, away_team_id: m.a })),
    opts.perTeam.map((t) => ({ team_id: t.team, covered: String(t.covered) })),
    opts.allTeams.map((t) => ({ t })),
    opts.resolve.map((r) => ({ fixture_id: r.id, provider_id: r.pid })),
    [{ committed: String(opts.committed) }],
    [{ used: String(opts.used) }],
  ];
}

// ── phase 1: dry-run plan ───────────────────────────────────────────────────────

describe('planEnrichmentJob · dry run (READ-ONLY)', () => {
  test('composes demand → targeted selection → provider ids → budget preview; issues NO writes', async () => {
    const { tx, calls } = captureTx(planQueue({
      completed: 250, covered: 37,
      missing: [
        { id: '100', k: '2026-02-01T00:00:00Z', h: '1', a: '2' },
        { id: '101', k: '2026-02-02T00:00:00Z', h: '1', a: '3' },
      ],
      perTeam: [], allTeams: ['1', '2', '3'],
      resolve: [{ id: '100', pid: 'p100' }, { id: '101', pid: 'p101' }],
      committed: 0, used: 0,
    }));
    const plan = await planEnrichmentJob(tx, '18', { asOf: ASOF, config: CONFIG });

    assert.equal(plan.jobId, defaultJobId('18', ASOF, 'TARGETED'));
    assert.equal(plan.mode, 'TARGETED');
    assert.deepEqual(plan.selected.map((f) => f.fixtureProviderId), ['p100', 'p101']); // one call each
    assert.equal(plan.estimatedCalls, 2);
    assert.equal(plan.budget.available, 200);       // 200 − 0 − 0 − 0
    assert.equal(plan.admissionPreview.admitted, true);
    assert.equal(plan.demand.missingFixtures, 2);

    // absolutely no mutation was attempted during a dry run
    assert.ok(!calls.some((c) => /\b(INSERT|UPDATE|DELETE)\b/i.test(c.sql)));
    assert.ok(!calls.some((c) => /pg_advisory_xact_lock/.test(c.sql))); // no reservation taken
  });

  test('bounded batch: maxCalls caps the selection (Phase 8 small controlled batch)', async () => {
    const { tx } = captureTx(planQueue({
      completed: 250, covered: 37,
      missing: [
        { id: '100', k: '2026-02-01T00:00:00Z', h: '1', a: '2' },
        { id: '101', k: '2026-02-02T00:00:00Z', h: '1', a: '3' },
      ],
      perTeam: [], allTeams: ['1', '2', '3'],
      resolve: [{ id: '100', pid: 'p100' }], // only the first is resolved because only it is capped-in
      committed: 0, used: 0,
    }));
    const plan = await planEnrichmentJob(tx, '18', { asOf: ASOF, config: CONFIG, maxCalls: 1 });
    assert.equal(plan.estimatedCalls, 1);
    assert.deepEqual(plan.selected.map((f) => f.fixtureId), ['100']);
  });

  test('a fixture with no resolvable provider id is excluded, never silently enriched', async () => {
    const { tx } = captureTx(planQueue({
      completed: 250, covered: 37,
      missing: [
        { id: '100', k: '2026-02-01T00:00:00Z', h: '1', a: '2' },
        { id: '101', k: '2026-02-02T00:00:00Z', h: '1', a: '3' },
      ],
      perTeam: [], allTeams: ['1', '2', '3'],
      resolve: [{ id: '100', pid: 'p100' }], // 101 has no provider id
      committed: 0, used: 0,
    }));
    const plan = await planEnrichmentJob(tx, '18', { asOf: ASOF, config: CONFIG });
    assert.deepEqual(plan.selected.map((f) => f.fixtureId), ['100']);
    assert.deepEqual(plan.unresolvedProviderIds, ['101']);
    assert.equal(plan.estimatedCalls, 1);
  });

  test('active committed reservations reduce the previewed budget', async () => {
    const { tx } = captureTx(planQueue({
      completed: 250, covered: 37,
      missing: [{ id: '100', k: '2026-02-01T00:00:00Z', h: '1', a: '2' }],
      perTeam: [], allTeams: ['1', '2'],
      resolve: [{ id: '100', pid: 'p100' }],
      committed: 190, used: 8, // available = 200 − 8 − 190 − 0 = 2
    }));
    const plan = await planEnrichmentJob(tx, '18', { asOf: ASOF, config: CONFIG });
    assert.equal(plan.budget.available, 2);
    assert.equal(plan.admissionPreview.admitted, true); // needs 1, has 2
  });

  test('FULL_BACKFILL mode selects every missing fixture', async () => {
    const { tx } = captureTx(planQueue({
      completed: 250, covered: 37,
      missing: [
        { id: '100', k: '2026-02-01T00:00:00Z', h: '1', a: '2' },
        { id: '101', k: '2026-02-02T00:00:00Z', h: '4', a: '5' }, // teams already at floor wouldn't be targeted
      ],
      perTeam: [{ team: '4', covered: 10 }, { team: '5', covered: 10 }],
      allTeams: ['1', '2', '4', '5'],
      resolve: [{ id: '100', pid: 'p100' }, { id: '101', pid: 'p101' }],
      committed: 0, used: 0,
    }));
    const plan = await planEnrichmentJob(tx, '18', { asOf: ASOF, config: CONFIG, mode: 'FULL_BACKFILL' });
    assert.equal(plan.mode, 'FULL_BACKFILL');
    assert.equal(plan.estimatedCalls, 2); // both, even though 101's teams are already covered
  });

  test('RESOLVE_PROVIDER_IDS_SQL is read-only and provider-scoped', () => {
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(RESOLVE_PROVIDER_IDS_SQL));
    assert.match(RESOLVE_PROVIDER_IDS_SQL, /provider_code = \$2::text/);
  });
});

// ── phase 2: admitted execution ─────────────────────────────────────────────────

function fakePlan(overrides: Partial<EnrichmentJobPlan> = {}): EnrichmentJobPlan {
  return {
    jobId: 'job1', editionId: '18', asOf: ASOF.toISOString(), mode: 'TARGETED',
    coverageKey: 'totalShotsOnGoal', attributeFloor: 8,
    selected: [
      { fixtureId: '100', fixturePartitionOn: 'p', fixtureProviderId: 'p100', kickoffAt: '2026-02-01T00:00:00Z', homeTeamId: '1', awayTeamId: '2' },
      { fixtureId: '101', fixturePartitionOn: 'p', fixtureProviderId: 'p101', kickoffAt: '2026-02-02T00:00:00Z', homeTeamId: '1', awayTeamId: '3' },
    ],
    estimatedCalls: 2, unresolvedProviderIds: [],
    budget: { dailyQuota: 200, actualUsedToday: 0, committed: 0, retryReserve: 0, available: 200 },
    admissionPreview: { code: 'ADMITTED', admitted: true, estMinCalls: 2, available: 200, shortfall: 0 },
    demand: { editionId: '18' } as any,
    ...overrides,
  };
}

const admittedDecision: ReservationDecision = {
  code: 'ADMITTED', admitted: true, reused: false, jobId: 'job1', estimatedCalls: 2,
  dailyQuota: 200, actualUsedToday: 0, committed: 0, retryReserve: 0, available: 200, shortfall: 0,
};
const rejectedDecision: ReservationDecision = {
  code: 'REJECTED_BUDGET', admitted: false, reused: false, jobId: 'job1', estimatedCalls: 2,
  dailyQuota: 200, actualUsedToday: 198, committed: 0, retryReserve: 0, available: 1, shortfall: 1,
};

function deps(over: Partial<EnrichmentExecutionDeps> & { admission?: ReservationDecision; perFixture?: (pid: string) => FixtureEnrichmentOutcome } = {}) {
  const enriched: string[] = [];
  const reconciledWith: number[] = [];
  const d: EnrichmentExecutionDeps = {
    admit: over.admit ?? (async () => over.admission ?? admittedDecision),
    enrichFixture: over.enrichFixture ?? (async (pid) => {
      enriched.push(pid);
      return over.perFixture ? over.perFixture(pid) : { fixtureProviderId: pid, providerCalls: 1, runStatus: 'SUCCEEDED' };
    }),
    reconcile: over.reconcile ?? (async (_j, actual) => { reconciledWith.push(actual); return true; }),
  };
  return { d, enriched, reconciledWith };
}

describe('executeEnrichmentJob · admitted execution', () => {
  test('refuses to spend without an explicit confirmRealEnrichment decision', async () => {
    const { d, enriched } = deps();
    await assert.rejects(() => executeEnrichmentJob(fakePlan(), d), /confirmRealEnrichment/);
    assert.equal(enriched.length, 0); // nothing enriched
  });

  test('happy path: one call per fixture, reconciled to ACTUAL total', async () => {
    const { d, enriched, reconciledWith } = deps();
    const res = await executeEnrichmentJob(fakePlan(), d, { confirmRealEnrichment: true });
    assert.deepEqual(enriched, ['p100', 'p101']); // both sides handled by the single per-fixture call
    assert.equal(res.attempted, 2);
    assert.equal(res.succeeded, 2);
    assert.equal(res.actualCalls, 2);
    assert.equal(res.overrun, false);
    assert.equal(res.reconciled, true);
    assert.deepEqual(reconciledWith, [2]); // reconciled to the measured 2, not merely the estimate
  });

  test('budget rejection performs ZERO provider calls and no reconcile', async () => {
    const { d, enriched, reconciledWith } = deps({ admission: rejectedDecision });
    const res = await executeEnrichmentJob(fakePlan(), d, { confirmRealEnrichment: true });
    assert.equal(res.admitted, false);
    assert.equal(res.attempted, 0);
    assert.equal(res.actualCalls, 0);
    assert.equal(res.reconciled, false);
    assert.equal(enriched.length, 0);
    assert.equal(reconciledWith.length, 0);
  });

  test('actual > estimate surfaces an overrun (never hidden), reconciled to actual', async () => {
    // each fixture reports 2 provider calls (e.g. a retry) → actual 4 vs estimate 2
    const { d, reconciledWith } = deps({ perFixture: (pid) => ({ fixtureProviderId: pid, providerCalls: 2, runStatus: 'SUCCEEDED' }) });
    const res = await executeEnrichmentJob(fakePlan(), d, { confirmRealEnrichment: true });
    assert.equal(res.actualCalls, 4);
    assert.equal(res.overrun, true);
    assert.equal(res.overrunBy, 2);
    assert.deepEqual(reconciledWith, [4]);
  });

  test('a hard-stopped fixture is counted and still reconciled by measured calls', async () => {
    const { d } = deps({
      perFixture: (pid) => pid === 'p101'
        ? { fixtureProviderId: pid, providerCalls: 1, runStatus: 'HARD_STOP', hardStopReason: 'provider 404' }
        : { fixtureProviderId: pid, providerCalls: 1, runStatus: 'SUCCEEDED' },
    });
    const res = await executeEnrichmentJob(fakePlan(), d, { confirmRealEnrichment: true });
    assert.equal(res.succeeded, 1);
    assert.equal(res.hardStopped, 1);
    assert.equal(res.actualCalls, 2);
  });
});
