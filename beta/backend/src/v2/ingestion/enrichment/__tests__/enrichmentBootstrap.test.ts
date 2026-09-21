// BOOTSTRAP ENRICHMENT DEMAND — lineup-aware + team-stat-aware (DB-free).
// Proves 2×/1×/0 costing, union selection (no stats-only bug, no lineup-only omission),
// determinism, per-edition + batch totals, strict eligibility (SQL), and governor hand-off.
// No provider call is made anywhere in this file.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  fixtureRequiredCalls, classifyBootstrapFixtures, selectBootstrapFixtures,
  perEditionBootstrapDemand, planBootstrapBatches, readBootstrapEnrichmentDemand,
  BOOTSTRAP_COVERAGE_SQL, type BootstrapFixture,
} from '../enrichmentPlanner';
import { computeBudget, admit } from '../budgetGovernor';

// raw coverage row helper
function row(id: string, edition: string, kickoff: string, hasLineup: boolean, hasStats: boolean) {
  return {
    fixture_id: id, fixture_partition_on: 'p', edition_id: edition, kickoff_at: kickoff,
    home_team_id: 'h', away_team_id: 'a', has_lineup: hasLineup, has_stats: hasStats,
  };
}
function captureTx(rows: unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const tx = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows }; } } as unknown as PoolClient;
  return { tx, calls };
}

// ── cost model (1–4) ──────────────────────────────────────────────────────────

describe('bootstrap · per-fixture cost', () => {
  test('both endpoints missing → 2 calls, selected', () => {
    assert.equal(fixtureRequiredCalls(false, false), 2);
  });
  test('lineup missing only → 1 call, selected', () => {
    assert.equal(fixtureRequiredCalls(false, true), 1);
  });
  test('stats missing only → 1 call, selected', () => {
    assert.equal(fixtureRequiredCalls(true, false), 1);
  });
  test('both present → 0 calls, excluded', () => {
    assert.equal(fixtureRequiredCalls(true, true), 0);
    const sel = selectBootstrapFixtures(classifyBootstrapFixtures([row('1', '18', '2026-02-01T00:00:00Z', true, true)]));
    assert.deepEqual(sel, []);
  });
});

// ── selection correctness (5, 6, 7, 15, 16, 17) ─────────────────────────────────

describe('bootstrap · selection is the union of both gap dimensions', () => {
  const fixtures = classifyBootstrapFixtures([
    row('10', '18', '2026-02-01T00:00:00Z', false, false), // both  → 2
    row('11', '18', '2026-02-02T00:00:00Z', false, true),  // lineup-only → 1
    row('12', '18', '2026-02-03T00:00:00Z', true, false),  // stats-only  → 1
    row('13', '18', '2026-02-04T00:00:00Z', true, true),   // complete    → excluded
  ]);

  test('mixed population: exact total cost = 2+1+1 = 4', () => {
    const sel = selectBootstrapFixtures(fixtures);
    assert.equal(sel.reduce((s, f) => s + f.requiredCalls, 0), 4);
  });
  test('NO stats-only omission: fixture with stats but missing lineup IS selected (defect #2 guard)', () => {
    const sel = selectBootstrapFixtures(fixtures);
    assert.ok(sel.some((f) => f.fixtureId === '11'), 'lineup-only fixture must be selected');
  });
  test('NO lineup-only omission: fixture with lineup but missing stats IS selected', () => {
    const sel = selectBootstrapFixtures(fixtures);
    assert.ok(sel.some((f) => f.fixtureId === '12'));
  });
  test('already-complete fixture excluded', () => {
    const sel = selectBootstrapFixtures(fixtures);
    assert.ok(!sel.some((f) => f.fixtureId === '13'));
  });
  test('no fixture is double-counted (each selected once)', () => {
    const sel = selectBootstrapFixtures(fixtures);
    assert.equal(new Set(sel.map((f) => f.fixtureId)).size, sel.length);
  });
});

// ── determinism (6) ─────────────────────────────────────────────────────────────

describe('bootstrap · deterministic ordering (edition, kickoff, fixtureId)', () => {
  test('sorts by edition, then kickoff, then id — regardless of input order', () => {
    const sel = selectBootstrapFixtures(classifyBootstrapFixtures([
      row('30', '147', '2026-02-01T00:00:00Z', false, false),
      row('20', '18', '2026-02-05T00:00:00Z', false, false),
      row('19', '18', '2026-02-05T00:00:00Z', false, false), // same kickoff as 20 → id tiebreak
      row('18', '18', '2026-02-01T00:00:00Z', false, false),
    ]));
    assert.deepEqual(sel.map((f) => f.fixtureId), ['18', '19', '20', '30']);
  });
});

// ── edition-18 expected (5, 12) ──────────────────────────────────────────────────

describe('bootstrap · edition 18 expected totals', () => {
  test('213 miss both, 0 lineup-only, 0 stat-only, 426 enrichment calls', () => {
    const rows = [];
    for (let i = 0; i < 213; i++) rows.push(row(`b${i}`, '18', `2026-02-01T00:00:0${i % 10}Z`, false, false)); // both
    for (let i = 0; i < 287; i++) rows.push(row(`c${i}`, '18', `2026-03-01T00:00:0${i % 10}Z`, true, true));  // complete
    const all = classifyBootstrapFixtures(rows);
    const per = perEditionBootstrapDemand(all);
    assert.equal(per.length, 1);
    assert.equal(per[0].completed, 500);
    assert.equal(per[0].missingBoth, 213);
    assert.equal(per[0].missingLineupOnly, 0);
    assert.equal(per[0].missingStatsOnly, 0);
    assert.equal(per[0].enrichmentCalls, 426);
  });
});

// ── per-edition + grouping (11, 12, 19) ─────────────────────────────────────────

describe('bootstrap · per-edition demand & grouping', () => {
  test('two editions: correct combined demand and grouping', () => {
    const all = classifyBootstrapFixtures([
      row('1', '18', '2026-02-01T00:00:00Z', false, false), // ed18: both → 2
      row('2', '18', '2026-02-02T00:00:00Z', true, false),  // ed18: stats-only → 1
      row('3', '143', '2026-02-01T00:00:00Z', false, true), // ed143: lineup-only → 1
      row('4', '143', '2026-02-02T00:00:00Z', true, true),  // ed143: complete → 0
    ]);
    const per = perEditionBootstrapDemand(all);
    assert.deepEqual(per.map((e) => e.editionId), ['18', '143']); // numeric-sorted grouping
    assert.equal(per[0].enrichmentCalls, 3); // 2*1 + 1
    assert.equal(per[1].enrichmentCalls, 1); // lineup-only
    assert.equal(per[1].completed, 2);
    // enrichmentCalls == 2*both + lineupOnly + statsOnly for every edition
    for (const e of per) assert.equal(e.enrichmentCalls, 2 * e.missingBoth + e.missingLineupOnly + e.missingStatsOnly);
  });
});

// ── batches (13) ─────────────────────────────────────────────────────────────────

describe('bootstrap · batch planning', () => {
  const selected: BootstrapFixture[] = selectBootstrapFixtures(classifyBootstrapFixtures([
    row('1', '18', '2026-02-01T00:00:00Z', false, false), // 2
    row('2', '18', '2026-02-02T00:00:00Z', false, true),  // 1 (lineup)
    row('3', '18', '2026-02-03T00:00:00Z', true, false),  // 1 (stats)
  ]));
  test('batch cost is the sum of atomic fixture costs, not fixtures×2', () => {
    const batches = planBootstrapBatches(selected, 2);
    assert.equal(batches.length, 2);
    // batch 0: fixtures 1,2 → lineupCalls 2, statCalls 1 → 3
    assert.equal(batches[0].fixtureCount, 2);
    assert.equal(batches[0].lineupCalls, 2);
    assert.equal(batches[0].statCalls, 1);
    assert.equal(batches[0].estimatedCalls, 3);
    // batch 1: fixture 3 → 1
    assert.equal(batches[1].estimatedCalls, 1);
    // total across batches == total estimated
    assert.equal(batches.reduce((s, b) => s + b.estimatedCalls, 0), 4);
  });
  test('positive batch size required', () => {
    assert.throws(() => planBootstrapBatches(selected, 0), /batchSize must be positive/);
  });
});

// ── SQL eligibility: strict asOf, completed-only, both EXISTS (8, 9, 10) ─────────

describe('bootstrap · coverage SQL contract', () => {
  test('completed-only, strict `< asOf`, independent lineup + ALL-period stat EXISTS, read-only', () => {
    assert.match(BOOTSTRAP_COVERAGE_SQL, /lifecycle_state_code = 'COMPLETED'/);
    assert.match(BOOTSTRAP_COVERAGE_SQL, /scheduled_kickoff_at < \$2::timestamptz/);
    assert.match(BOOTSTRAP_COVERAGE_SQL, /FROM football\.lineup l/);
    assert.match(BOOTSTRAP_COVERAGE_SQL, /FROM football\.team_match_statistic s[\s\S]*period = 'ALL'/);
    assert.match(BOOTSTRAP_COVERAGE_SQL, /competition_edition_id = ANY\(\$1::bigint\[\]\)/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(BOOTSTRAP_COVERAGE_SQL));
  });
});

// ── reader binding + governor hand-off (14, 18, 20) ─────────────────────────────

describe('bootstrap · reader + governor integration', () => {
  test('reader composes selection, per-edition, estimatedCalls and passes editions to SQL', async () => {
    const { tx, calls } = captureTx([
      row('1', '18', '2026-02-01T00:00:00Z', false, false),
      row('2', '18', '2026-02-02T00:00:00Z', true, true), // complete → excluded
      row('3', '143', '2026-02-01T00:00:00Z', false, true),
    ]);
    const demand = await readBootstrapEnrichmentDemand(tx, ['18', '143'], { asOf: new Date('2026-06-01T00:00:00Z'), batchSize: 10 });
    assert.deepEqual(demand.selectedFixtureIds, ['1', '3']); // 2 excluded (complete)
    assert.equal(demand.estimatedCalls, 3); // fixture1 (2) + fixture3 (1)
    assert.equal(demand.missingBoth, 1);
    assert.equal(demand.missingLineupOnly, 1);
    assert.equal(demand.perEdition.length, 2);
    assert.deepEqual(calls[0].params[0], ['18', '143']); // editions bound to $1
    assert.ok(demand.batches && demand.batches[0].estimatedCalls === 3);
    assert.equal(calls.length, 1); // NO provider call, one read
  });

  test('empty scope → zero calls, no SQL error path', async () => {
    const { tx, calls } = captureTx([]);
    const demand = await readBootstrapEnrichmentDemand(tx, [], { asOf: new Date() });
    assert.equal(demand.estimatedCalls, 0);
    assert.deepEqual(demand.selectedFixtureIds, []);
    assert.equal(calls.length, 0); // no query issued for empty scope
  });

  test('governor receives the EXACT estimatedCalls (planner plans, governor admits)', async () => {
    const { tx } = captureTx([
      row('1', '18', '2026-02-01T00:00:00Z', false, false),
      row('2', '18', '2026-02-02T00:00:00Z', false, false),
    ]);
    const demand = await readBootstrapEnrichmentDemand(tx, ['18'], { asOf: new Date('2026-06-01T00:00:00Z') });
    assert.equal(demand.estimatedCalls, 4); // 2 fixtures × both
    const budget = computeBudget({ dailyQuota: 7600, actualUsedToday: 0, committed: 0, retryReserve: 0 });
    const decision = admit(demand.estimatedCalls, budget);
    assert.equal(decision.estMinCalls, 4);   // the governor admits the exact planned demand, not fixture count
    assert.equal(decision.admitted, true);
  });
});
