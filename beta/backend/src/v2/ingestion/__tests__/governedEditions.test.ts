// GOVERNED EDITIONS (Gate 5) TESTS. No provider, no database.
//
// Proves the wiring: selectAuthorizedEditions → runGovernedSeason, fail-closed on
// empty selection, each authorized edition executed exactly once THROUGH the
// governed boundary (never ingestSeason directly), total-budget semantics, and
// fail-fast aggregate behaviour.

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

const WINDOW = { from: new Date('2026-08-12T00:00:00Z'), to: new Date('2026-08-19T00:00:00Z') };

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
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 8 }, { select: async () => [edition('325', '87678')], run });
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
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 30 }, { select: async () => eds, run });
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((c) => c.competitionProviderId), ['325', '373', '384']);
    assert.equal(result.outcomes.filter((o) => o.status === 'SUCCEEDED').length, 3);
    assert.equal(result.aggregate, 'SUCCEEDED');
  });

  test('only the selected editions are dispatched — nothing ungoverned is invented', async () => {
    const { run, calls } = recordingRun([ok(1)]);
    await runGovernedEditions({ ...WINDOW, maxCalls: 8 }, { select: async () => [edition('325', '87678')], run });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].competitionProviderId, '325'); // exactly what selection returned
  });
});

describe('governed editions · total-budget semantics', () => {
  test('--max-calls is a TOTAL ceiling: each edition receives the remaining budget', async () => {
    const seen: number[] = [];
    const run: NonNullable<GovernedEditionsDeps['run']> = async (a) => { seen.push(a.maxCalls); return ok(3); };
    await runGovernedEditions({ ...WINDOW, maxCalls: 10 }, { select: async () => [edition('325', '87678'), edition('373', '89353')], run });
    assert.deepEqual(seen, [10, 7], 'edition 2 gets remaining budget (10 - 3 spent), not a fresh 10');
  });

  test('when the budget is exhausted, further editions are SKIPPED_BUDGET (not dispatched)', async () => {
    const { run, calls } = recordingRun([ok(8)]); // first edition spends the whole budget
    const eds = [edition('325', '87678'), edition('373', '89353')];
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 8 }, { select: async () => eds, run });
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
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 30 }, { select: async () => eds, run });
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
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 30 }, { select: async () => eds, run });
    assert.deepEqual(result.outcomes.map((o) => o.status), ['SUCCEEDED', 'FAILED', 'NOT_ATTEMPTED']);
    assert.match(result.outcomes[1].detail ?? '', /GOVERNANCE_REVOKED/);
    assert.equal(result.aggregate, 'FAILED');
  });

  test('a mid-run REFUSED (revoked between selection and dispatch) stops the run', async () => {
    const { run } = recordingRun([ok(2), refused(), ok(2)]);
    const eds = [edition('325', '87678'), edition('373', '89353'), edition('384', '87760')];
    const result = await runGovernedEditions({ ...WINDOW, maxCalls: 30 }, { select: async () => eds, run });
    assert.deepEqual(result.outcomes.map((o) => o.status), ['SUCCEEDED', 'REFUSED', 'NOT_ATTEMPTED']);
    assert.equal(result.aggregate, 'FAILED');
  });
});
