// GOVERNED EDITIONS (Gate 5 + Gate 6D) TESTS. No provider, no database.
//
// Proves the wiring: selectAuthorizedEditions → (Gate 6C derive) → runGovernedSeason,
// fail-closed on empty selection, each authorized edition executed exactly once per
// uncovered gap THROUGH the governed boundary (never ingestSeason directly),
// GLOBAL total-budget semantics across editions AND gaps, coverage-aware no-work
// with zero provider calls, and fail-fast aggregate behaviour.
//
// The Gate 6C derivation is injected through the `derive` seam so these tests stay
// database-free; the real interval math is proven in coverageWindows.test.ts.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseGovernedEditionsArguments,
  runGovernedEditions,
  type GovernedEditionsDeps,
} from '../orchestration/governedEditions';
import type { AuthorizedEdition } from '../orchestration/governedSelection';
import type { GovernedRunResult } from '../orchestration/governedSeason';
import type { SeasonIngestionReport } from '../pipeline';
import type { DateInterval, UncoveredDerivation } from '../coverageWindows';

const WINDOW = { from: new Date('2026-08-12T00:00:00Z'), to: new Date('2026-08-19T00:00:00Z') };
// Operator window [2026-08-12..2026-08-19] as the half-open range Gate 6C returns.
const WINDOW_HALF_OPEN = { from: '2026-08-12', to: '2026-08-20' };

function edition(comp: string, season: string): AuthorizedEdition {
  return {
    providerCode: 'SPORTSAPI_API',
    competitionProviderExternalId: comp,
    seasonProviderExternalId: season,
    competitionId: '28',
    competitionEditionId: '18',
    seasonPeriod: { from: '2026-01-01', to: '2027-01-01' },
  };
}

/** A GovernedRunResult that AUTHORIZED and succeeded, spending `calls`. */
function ok(calls: number): GovernedRunResult {
  return { outcome: 'AUTHORIZED', authorizationCount: 1, report: { callsSpent: calls, failed: false } as unknown as SeasonIngestionReport };
}
function failedReport(calls: number): GovernedRunResult {
  return { outcome: 'AUTHORIZED', authorizationCount: 1, report: { callsSpent: calls, failed: true } as unknown as SeasonIngestionReport };
}
function refused(): GovernedRunResult {
  return { outcome: 'UNAUTHORIZED', authorizationCount: 0, report: null };
}

/** Records every run() dispatch. */
function recordingRun(results: GovernedRunResult[] | ((call: number, args: any) => GovernedRunResult | Promise<GovernedRunResult> | never)) {
  const calls: any[] = [];
  const run: NonNullable<GovernedEditionsDeps['run']> = async (args) => {
    const i = calls.length;
    calls.push(args);
    if (typeof results === 'function') return results(i, args);
    return results[i];
  };
  return { run, calls };
}

/** Builds an UncoveredDerivation from a list of half-open gaps (noWork when empty). */
function derivation(uncovered: readonly DateInterval[], reason?: UncoveredDerivation['reason']): UncoveredDerivation {
  return {
    requested: WINDOW_HALF_OPEN,
    covered: [],
    uncovered,
    noWork: uncovered.length === 0,
    reason: uncovered.length === 0 ? (reason ?? 'FULLY_COVERED') : undefined,
  };
}

/** A derive seam that reports the ENTIRE operator window as one uncovered gap. */
const wholeWindow: NonNullable<GovernedEditionsDeps['derive']> = async () => derivation([WINDOW_HALF_OPEN]);

/** A derive seam returning a fixed set of gaps for every edition. */
function derivingGaps(...gaps: DateInterval[]): NonNullable<GovernedEditionsDeps['derive']> {
  return async () => derivation(gaps);
}

describe('governed editions · argument parsing', () => {
  test('requires --from, --to, --max-calls', () => {
    assert.throws(() => parseGovernedEditionsArguments(['--to', '2026-08-19', '--max-calls', '8']), /--from is required/);
    assert.throws(() => parseGovernedEditionsArguments(['--from', '2026-08-12', '--max-calls', '8']), /--to is required/);
    assert.throws(() => parseGovernedEditionsArguments(['--from', '2026-08-12', '--to', '2026-08-19']), /--max-calls is required/);
  });
  test('rejects inverted window and non-positive budget', () => {
    assert.throws(() => parseGovernedEditionsArguments(['--from', '2026-08-19', '--to', '2026-08-12', '--max-calls', '8']), /precedes/);
    assert.throws(() => parseGovernedEditionsArguments(['--from', '2026-08-12', '--to', '2026-08-19', '--max-calls', '0']), /--max-calls/);
  });
});

describe('governed editions · fail-closed selection', () => {
  test('zero authorized editions → zero execution, NOOP aggregate', async () => {
    const { run, calls } = recordingRun([]);
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 8 }, { select: async () => [], run });
    assert.equal(calls.length, 0, 'ingestion is never dispatched');
    assert.equal(result.selected, 0);
    assert.equal(result.aggregate, 'NOOP');
  });

  test('a selection/query error propagates (never silently ingests nothing-as-success)', async () => {
    await assert.rejects(
      runGovernedEditions({ ...WINDOW, maxCalls: 8 }, { select: async () => { throw new Error('gov read failed'); }, run: async () => ok(1) }),
      /gov read failed/
    );
  });
});

describe('governed editions · executes only selected editions, each once, via the governed boundary', () => {
  test('one authorized edition → exactly one governed execution with the operator window', async () => {
    const { run, calls } = recordingRun([ok(3)]);
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 8 }, { select: async () => [edition('325', '87678')], run, derive: wholeWindow });
    assert.equal(calls.length, 1);
    assert.deepEqual(
      { c: calls[0].competitionProviderId, s: calls[0].seasonProviderId, from: calls[0].from, to: calls[0].to, provider: calls[0].providerCode },
      { c: '325', s: '87678', from: WINDOW.from, to: WINDOW.to, provider: 'SPORTSAPI_API' }
    );
    assert.equal(result.aggregate, 'SUCCEEDED');
    assert.equal(result.outcomes[0].status, 'SUCCEEDED');
  });

  test('multiple authorized editions → each executed exactly once, in order', async () => {
    const { run, calls } = recordingRun([ok(2), ok(2), ok(2)]);
    const eds = [edition('325', '87678'), edition('373', '89353'), edition('384', '87760')];
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 30 }, { select: async () => eds, run, derive: wholeWindow });
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((c) => c.competitionProviderId), ['325', '373', '384']);
    assert.equal(result.outcomes.filter((o) => o.status === 'SUCCEEDED').length, 3);
    assert.equal(result.aggregate, 'SUCCEEDED');
  });

  test('only the selected editions are dispatched — nothing ungoverned is invented', async () => {
    const { run, calls } = recordingRun([ok(1)]);
    await runGovernedEditions({ ...WINDOW, maxCalls: 8 }, { select: async () => [edition('325', '87678')], run, derive: wholeWindow });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].competitionProviderId, '325'); // exactly what selection returned
  });
});

describe('governed editions · total-budget semantics', () => {
  test('--max-calls is a TOTAL ceiling: each edition receives the remaining budget', async () => {
    const seen: number[] = [];
    const run: NonNullable<GovernedEditionsDeps['run']> = async (a) => { seen.push(a.maxCalls); return ok(3); };
    await runGovernedEditions({ ...WINDOW, maxCalls: 10 }, { select: async () => [edition('325', '87678'), edition('373', '89353')], run, derive: wholeWindow });
    assert.deepEqual(seen, [10, 7], 'edition 2 gets remaining budget (10 - 3 spent), not a fresh 10');
  });

  test('when the budget is exhausted, further editions are SKIPPED_BUDGET (not dispatched)', async () => {
    const { run, calls } = recordingRun([ok(8)]); // first edition spends the whole budget
    const eds = [edition('325', '87678'), edition('373', '89353')];
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 8 }, { select: async () => eds, run, derive: wholeWindow });
    assert.equal(calls.length, 1, 'the second edition is not dispatched once budget < 1');
    assert.equal(result.outcomes[1].status, 'SKIPPED_BUDGET');
    assert.equal(result.aggregate, 'SUCCEEDED', 'a budget skip is expected bounded behaviour, not a failure');
    assert.equal(result.totalCallsSpent, 8);
  });
});

describe('governed editions · fail-fast aggregate', () => {
  test('a failed edition stops the run; later editions are NOT_ATTEMPTED; aggregate FAILED', async () => {
    const { run, calls } = recordingRun([ok(2), failedReport(1), ok(2)]);
    const eds = [edition('325', '87678'), edition('373', '89353'), edition('384', '87760')];
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 30 }, { select: async () => eds, run, derive: wholeWindow });
    assert.equal(calls.length, 2, 'stops after the failing edition');
    assert.deepEqual(result.outcomes.map((o) => o.status), ['SUCCEEDED', 'FAILED', 'NOT_ATTEMPTED']);
    assert.equal(result.aggregate, 'FAILED');
  });

  test('a thrown error (e.g. at-commit revocation) stops the run; aggregate FAILED', async () => {
    const run: NonNullable<GovernedEditionsDeps['run']> = async (a) => {
      if (a.competitionProviderId === '373') throw new Error('GOVERNANCE_REVOKED: ...');
      return ok(2);
    };
    const eds = [edition('325', '87678'), edition('373', '89353'), edition('384', '87760')];
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 30 }, { select: async () => eds, run, derive: wholeWindow });
    assert.deepEqual(result.outcomes.map((o) => o.status), ['SUCCEEDED', 'FAILED', 'NOT_ATTEMPTED']);
    assert.match(result.outcomes[1].detail ?? '', /GOVERNANCE_REVOKED/);
    assert.equal(result.aggregate, 'FAILED');
  });

  test('a mid-run REFUSED (revoked between selection and dispatch) stops the run', async () => {
    const { run } = recordingRun([ok(2), refused(), ok(2)]);
    const eds = [edition('325', '87678'), edition('373', '89353'), edition('384', '87760')];
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 30 }, { select: async () => eds, run, derive: wholeWindow });
    assert.deepEqual(result.outcomes.map((o) => o.status), ['SUCCEEDED', 'REFUSED', 'NOT_ATTEMPTED']);
    assert.equal(result.aggregate, 'FAILED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Gate 6D — coverage-aware window derivation wired into the governed path.
// ─────────────────────────────────────────────────────────────────────────────
describe('governed editions · Gate 6D coverage-aware dispatch', () => {
  test('a fully-covered edition is NO_WORK with ZERO provider calls', async () => {
    const { run, calls } = recordingRun([]);
    const result = await runGovernedEditions(
      { ...WINDOW, maxCalls: 8 },
      { select: async () => [edition('325', '87678')], run, derive: async () => derivation([]) }
    );
    assert.equal(calls.length, 0, 'no gap ⇒ the provider is never called');
    assert.equal(result.outcomes[0].status, 'NO_WORK');
    assert.equal(result.outcomes[0].gaps, 0);
    assert.equal(result.outcomes[0].callsSpent, 0);
    assert.equal(result.outcomes[0].detail, 'FULLY_COVERED');
    assert.equal(result.totalCallsSpent, 0);
    assert.equal(result.aggregate, 'SUCCEEDED', 'no work is success, not failure');
  });

  test('one uncovered gap → exactly one dispatch over the gap window (inclusive dates preserved)', async () => {
    const { run, calls } = recordingRun([ok(2)]);
    const result = await runGovernedEditions(
      { ...WINDOW, maxCalls: 8 },
      { select: async () => [edition('325', '87678')], run, derive: derivingGaps({ from: '2026-08-14', to: '2026-08-17' }) }
    );
    assert.equal(calls.length, 1);
    // Half-open [2026-08-14, 2026-08-17) → inclusive dispatch window [2026-08-14..2026-08-16].
    assert.deepEqual(
      { from: calls[0].from.toISOString().slice(0, 10), to: calls[0].to.toISOString().slice(0, 10) },
      { from: '2026-08-14', to: '2026-08-16' }
    );
    assert.equal(result.outcomes[0].status, 'SUCCEEDED');
    assert.equal(result.outcomes[0].gaps, 1);
    assert.equal(result.outcomes[0].callsSpent, 2);
  });

  test('multiple uncovered gaps → one dispatch per gap, each converted to inclusive dates', async () => {
    const { run, calls } = recordingRun([ok(1), ok(1)]);
    const result = await runGovernedEditions(
      { ...WINDOW, maxCalls: 8 },
      {
        select: async () => [edition('325', '87678')],
        run,
        derive: derivingGaps({ from: '2026-08-12', to: '2026-08-14' }, { from: '2026-08-17', to: '2026-08-20' }),
      }
    );
    assert.equal(calls.length, 2, 'both gaps dispatched');
    assert.deepEqual(
      calls.map((c) => [c.from.toISOString().slice(0, 10), c.to.toISOString().slice(0, 10)]),
      [['2026-08-12', '2026-08-13'], ['2026-08-17', '2026-08-19']]
    );
    assert.equal(result.outcomes[0].gaps, 2);
    assert.equal(result.outcomes[0].callsSpent, 2);
    assert.equal(result.aggregate, 'SUCCEEDED');
  });

  test('--max-calls is GLOBAL across gaps: each gap receives the remaining budget, never a per-gap reset', async () => {
    const seen: number[] = [];
    const run: NonNullable<GovernedEditionsDeps['run']> = async (a) => { seen.push(a.maxCalls); return ok(3); };
    await runGovernedEditions(
      { ...WINDOW, maxCalls: 10 },
      {
        select: async () => [edition('325', '87678')],
        run,
        derive: derivingGaps({ from: '2026-08-12', to: '2026-08-14' }, { from: '2026-08-16', to: '2026-08-18' }),
      }
    );
    assert.deepEqual(seen, [10, 7], 'gap 2 gets the budget left after gap 1 (10 - 3), not a fresh 10');
  });

  test('the GLOBAL budget spans editions AND their gaps', async () => {
    const seen: number[] = [];
    const run: NonNullable<GovernedEditionsDeps['run']> = async (a) => { seen.push(a.maxCalls); return ok(2); };
    await runGovernedEditions(
      { ...WINDOW, maxCalls: 20 },
      {
        select: async () => [edition('325', '87678'), edition('373', '89353')],
        run,
        // each edition derives two gaps ⇒ four dispatches drawing one shared budget
        derive: derivingGaps({ from: '2026-08-12', to: '2026-08-14' }, { from: '2026-08-16', to: '2026-08-18' }),
      }
    );
    assert.deepEqual(seen, [20, 18, 16, 14], 'one monotonically-decreasing budget across all editions and gaps');
  });

  test('budget exhausted mid-gaps → the later gap is SKIPPED_BUDGET (not dispatched)', async () => {
    const { run, calls } = recordingRun([ok(8)]); // first gap spends the whole budget
    const result = await runGovernedEditions(
      { ...WINDOW, maxCalls: 8 },
      {
        select: async () => [edition('325', '87678')],
        run,
        derive: derivingGaps({ from: '2026-08-12', to: '2026-08-14' }, { from: '2026-08-16', to: '2026-08-18' }),
      }
    );
    assert.equal(calls.length, 1, 'the second gap is not dispatched once budget < 1');
    assert.equal(result.outcomes[0].status, 'SKIPPED_BUDGET');
    assert.match(result.outcomes[0].detail ?? '', /budget exhausted after 1\/2 gap/);
    assert.equal(result.aggregate, 'SUCCEEDED', 'a budget skip is bounded behaviour, not a failure');
  });

  test('a NO_WORK edition consumes no budget; later editions still dispatch', async () => {
    const { run, calls } = recordingRun([ok(2)]);
    const derive: NonNullable<GovernedEditionsDeps['derive']> = async (e) =>
      e.competitionProviderExternalId === '325' ? derivation([]) : derivation([WINDOW_HALF_OPEN]);
    const result = await runGovernedEditions(
      { ...WINDOW, maxCalls: 8 },
      { select: async () => [edition('325', '87678'), edition('373', '89353')], run, derive }
    );
    assert.equal(calls.length, 1, 'only the edition with a gap is dispatched');
    assert.equal(calls[0].competitionProviderId, '373');
    assert.deepEqual(result.outcomes.map((o) => o.status), ['NO_WORK', 'SUCCEEDED']);
    assert.equal(result.totalCallsSpent, 2);
    assert.equal(result.aggregate, 'SUCCEEDED');
  });

  test('a derivation failure fails the edition and stops the run (fail-closed, fail-fast)', async () => {
    const { run, calls } = recordingRun([ok(2)]);
    const derive: NonNullable<GovernedEditionsDeps['derive']> = async () => { throw new Error('coverage read exploded'); };
    const result = await runGovernedEditions(
      { ...WINDOW, maxCalls: 8 },
      { select: async () => [edition('325', '87678'), edition('373', '89353')], run, derive }
    );
    assert.equal(calls.length, 0, 'a failed derivation never dispatches ingestion');
    assert.deepEqual(result.outcomes.map((o) => o.status), ['FAILED', 'NOT_ATTEMPTED']);
    assert.match(result.outcomes[0].detail ?? '', /derivation failed: coverage read exploded/);
    assert.equal(result.aggregate, 'FAILED');
  });

  test('an edition with no materialized reality row (null competitionEditionId) ingests the whole window without a coverage read', async () => {
    const { run, calls } = recordingRun([ok(2)]);
    let deriveCalled = false;
    const derive: NonNullable<GovernedEditionsDeps['derive']> = async () => { deriveCalled = true; return derivation([WINDOW_HALF_OPEN]); };
    const ed = { ...edition('325', '87678'), competitionEditionId: null } as AuthorizedEdition;
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 8 }, { select: async () => [ed], run, derive });
    assert.equal(deriveCalled, false, 'no coverage read when there is no edition row to read coverage for');
    assert.equal(calls.length, 1);
    assert.deepEqual(
      { from: calls[0].from.toISOString().slice(0, 10), to: calls[0].to.toISOString().slice(0, 10) },
      { from: '2026-08-12', to: '2026-08-19' },
      'the whole operator window is dispatched, inclusive'
    );
    assert.equal(result.outcomes[0].status, 'SUCCEEDED');
    assert.equal(result.outcomes[0].gaps, 1);
  });
});
