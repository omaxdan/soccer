// GOVERNED SEASON ORCHESTRATION TESTS. No provider, no database.
//
// Proves the governance BOUNDARY: argument parsing, the fail-closed classifier,
// that the authorization predicate carries all six governance conjuncts, and that
// the boundary calls the existing ingestSeason ONLY on exactly one authorized row
// and refuses (without calling it) otherwise.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseGovernedArguments,
  classifyAuthorization,
  runGovernedSeason,
  AUTHORIZATION_SQL,
  DEFAULT_GOVERNED_MAX_CALLS,
  type GovernedArguments,
} from '../orchestration/governedSeason';
import type { SeasonIngestionReport } from '../pipeline';
import { PROVIDER_CODE } from '../provider/config';

const OK = { competitionProviderId: '325', seasonProviderId: '87678' };

function args(overrides: Partial<GovernedArguments> = {}): GovernedArguments {
  return {
    providerCode: PROVIDER_CODE,
    competitionProviderId: '325',
    seasonProviderId: '87678',
    from: new Date('2026-08-12T00:00:00Z'),
    to: new Date('2026-08-19T00:00:00Z'),
    maxCalls: 4,
    ...overrides,
  };
}

const fakeReport = { failed: false } as unknown as SeasonIngestionReport;

describe('governed season · argument parsing', () => {
  test('accepts explicit tournament/season/window and defaults provider + max-calls', () => {
    const a = parseGovernedArguments(['--tournament', '325', '--season', '87678', '--from', '2026-08-12', '--to', '2026-08-19']);
    assert.equal(a.competitionProviderId, '325');
    assert.equal(a.seasonProviderId, '87678');
    assert.equal(a.providerCode, PROVIDER_CODE); // defaults to the one ingestion constant
    assert.equal(a.maxCalls, DEFAULT_GOVERNED_MAX_CALLS);
    assert.equal(a.from.toISOString().slice(0, 10), '2026-08-12');
    assert.equal(a.to.toISOString().slice(0, 10), '2026-08-19');
  });

  test('accepts --max-calls and --provider overrides', () => {
    const a = parseGovernedArguments([
      '--tournament', '325', '--season', '87678', '--from', '2026-08-12', '--to', '2026-08-19',
      '--max-calls', '4', '--provider', 'SPORTSAPI_API',
    ]);
    assert.equal(a.maxCalls, 4);
    assert.equal(a.providerCode, 'SPORTSAPI_API');
  });

  test('requires each of tournament/season/from/to', () => {
    assert.throws(() => parseGovernedArguments(['--season', '87678', '--from', '2026-08-12', '--to', '2026-08-19']), /--tournament is required/);
    assert.throws(() => parseGovernedArguments(['--tournament', '325', '--from', '2026-08-12', '--to', '2026-08-19']), /--season is required/);
    assert.throws(() => parseGovernedArguments(['--tournament', '325', '--season', '87678', '--to', '2026-08-19']), /--from is required/);
    assert.throws(() => parseGovernedArguments(['--tournament', '325', '--season', '87678', '--from', '2026-08-12']), /--to is required/);
  });

  test('rejects an inverted window and a non-positive --max-calls', () => {
    assert.throws(
      () => parseGovernedArguments(['--tournament', '325', '--season', '87678', '--from', '2026-08-19', '--to', '2026-08-12']),
      /precedes/
    );
    assert.throws(
      () => parseGovernedArguments(['--tournament', '325', '--season', '87678', '--from', '2026-08-12', '--to', '2026-08-19', '--max-calls', '0']),
      /--max-calls/
    );
  });
});

describe('governed season · authorization classifier', () => {
  test('exactly one authorizes; zero and many refuse', () => {
    assert.equal(classifyAuthorization(1), 'AUTHORIZED');
    assert.equal(classifyAuthorization(0), 'UNAUTHORIZED');
    assert.equal(classifyAuthorization(2), 'AMBIGUOUS');
  });
});

describe('governed season · authorization predicate', () => {
  test('carries all six governance conjuncts', () => {
    for (const clause of [
      'tc.provider_code = $1',
      'tc.provider_external_id = $2',
      "tc.tracking_status_code = 'TRACKED'",
      'te.provider_season_external_id = $3',
      "te.edition_status_code = 'ACTIVE'",
      'te.authorized_for_ingestion = true',
    ]) {
      assert.ok(AUTHORIZATION_SQL.includes(clause), `predicate must contain: ${clause}`);
    }
  });
});

describe('governed season · fail-closed dispatch', () => {
  test('one authorized row => calls ingestSeason once with the explicit ids/window', async () => {
    const calls: unknown[] = [];
    const ingest = (async (opts: unknown) => {
      calls.push(opts);
      return fakeReport;
    }) as typeof import('../pipeline').ingestSeason;

    const result = await runGovernedSeason(args(OK), { authorize: async () => 1, ingest });

    assert.equal(result.outcome, 'AUTHORIZED');
    assert.equal(calls.length, 1);
    const passed = calls[0] as { competitionProviderId: string; seasonProviderId: string; maxCalls: number };
    assert.equal(passed.competitionProviderId, '325');
    assert.equal(passed.seasonProviderId, '87678');
    assert.equal(passed.maxCalls, 4);
    assert.notEqual(result.report, null);
  });

  test('zero authorized rows => ingestSeason is NEVER called (fail-closed)', async () => {
    let called = 0;
    const ingest = (async () => {
      called += 1;
      return fakeReport;
    }) as typeof import('../pipeline').ingestSeason;

    const result = await runGovernedSeason(args(OK), { authorize: async () => 0, ingest });
    assert.equal(result.outcome, 'UNAUTHORIZED');
    assert.equal(called, 0);
    assert.equal(result.report, null);
  });

  test('more than one authorized row => refuse, ingestSeason NEVER called', async () => {
    let called = 0;
    const ingest = (async () => {
      called += 1;
      return fakeReport;
    }) as typeof import('../pipeline').ingestSeason;

    const result = await runGovernedSeason(args(OK), { authorize: async () => 2, ingest });
    assert.equal(result.outcome, 'AMBIGUOUS');
    assert.equal(called, 0);
    assert.equal(result.report, null);
  });
});
