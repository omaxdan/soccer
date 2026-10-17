// SCOPED FEATURE REPLAY — focused tests (DB-free; mock PoolClient, no network).
//
// Locks the additive `--edition` / `--feature` scoping on feature:v2 replay:
//   • CLI parses repeatable + comma-separated --edition / --feature, on calculate AND
//     replay, and leaves them undefined when absent (unscoped = unchanged behaviour);
//   • invalid edition ids and unknown feature keys fail CLEARLY, never silently global;
//   • the edition filter reaches the fixture-eligibility query (ANY predicate + param),
//     and is ABSENT when unscoped — it narrows generating fixtures only;
//   • feature gating selects exactly the requested registered calculators;
//   • the squad-stability historical read is NOT edition-filtered (cross-competition);
//   • the replay path imports no module / snapshot / calibration / provider code.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PoolClient } from 'pg';

import { parseArguments } from '../cli';
import {
  CALCULATORS, knownFeatureKeys, assertKnownFeatureKeys, calculatorRequested,
} from '../pipeline';
import { selectBatches } from '../driver/eligibility';
import type { Registry } from '../registry/load';

const HERE = __dirname;

// ── CLI parsing + validation ─────────────────────────────────────────────────────

describe('CLI — edition/feature scope parsing', () => {
  test('absent → unscoped (both fields undefined), existing behaviour unchanged', () => {
    const inv = parseArguments(['replay', '--from', '2026-01-28', '--to', '2026-09-20']);
    assert.equal(inv.competitionEditionIds, undefined);
    assert.equal(inv.featureKeys, undefined);
  });
  test('--edition is repeatable AND comma-separated, flattened in order', () => {
    const inv = parseArguments([
      'replay', '--from', '2026-01-28', '--to', '2026-09-20',
      '--edition', '147', '--edition', '18,143',
    ]);
    assert.deepEqual(inv.competitionEditionIds, ['147', '18', '143']);
  });
  test('--feature validated against the registry; valid keys captured', () => {
    const inv = parseArguments([
      'replay', '--from', '2026-01-28', '--to', '2026-09-20',
      '--feature', 'team.squad_stability',
    ]);
    assert.deepEqual(inv.featureKeys, ['team.squad_stability']);
  });
  test('scope flags also apply to calculate', () => {
    const inv = parseArguments(['calculate', '--edition', '147', '--feature', 'team.squad_stability']);
    assert.equal(inv.command, 'calculate');
    assert.deepEqual(inv.competitionEditionIds, ['147']);
    assert.deepEqual(inv.featureKeys, ['team.squad_stability']);
  });
  test('non-numeric edition id fails clearly (never silently global)', () => {
    assert.throws(
      () => parseArguments(['replay', '--from', '2026-01-28', '--to', '2026-09-20', '--edition', 'abc']),
      /--edition expects positive integer/,
    );
  });
  test('unknown feature key fails clearly, listing the valid keys', () => {
    assert.throws(
      () => parseArguments(['replay', '--from', '2026-01-28', '--to', '2026-09-20', '--feature', 'team.not_a_feature']),
      /unknown feature key/,
    );
  });
  test('existing replay/calculate/verify parsing is unchanged', () => {
    assert.equal(parseArguments([]).command, 'calculate');
    assert.equal(parseArguments([]).dryRun, false);
    assert.equal(parseArguments(['calculate', '--dry-run']).dryRun, true);
    assert.throws(() => parseArguments(['replay']), /requires --from and --to/);
    assert.equal(parseArguments(['verify']).command, 'verify');
  });
});

// ── feature-key universe + gating ────────────────────────────────────────────────

describe('feature-key universe + gating', () => {
  test('knownFeatureKeys covers the lineup-driven feature', () => {
    assert.ok(knownFeatureKeys().has('team.squad_stability'));
  });
  test('assertKnownFeatureKeys: valid passes, unknown throws', () => {
    assert.doesNotThrow(() => assertKnownFeatureKeys(['team.squad_stability']));
    assert.throws(() => assertKnownFeatureKeys(['nope']), /unknown feature key/);
  });
  test('null request matches every calculator (unscoped)', () => {
    for (const c of CALCULATORS) assert.equal(calculatorRequested(c, null), true);
  });
  test('a requested set executes ONLY the calculators producing those keys', () => {
    const requested = new Set(['team.squad_stability']);
    const selected = CALCULATORS.filter((c) => calculatorRequested(c, requested)).map((c) => c.calculatorKey);
    assert.deepEqual(selected, ['squad_continuity']); // exactly one calculator, nothing else
  });
});

// ── edition filter reaches the eligibility query (mock client) ───────────────────

function mockRegistry(): Registry {
  return { snapshotPoints: [{ code: 'KICKOFF', offsetSeconds: 0 }] } as unknown as Registry;
}
function captureTx(rows: unknown[], calls: { sql: string; params: unknown[] }[]): PoolClient {
  return {
    query: async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows };
    },
  } as unknown as PoolClient;
}
const FIXTURE_ROW = {
  fixture_id: '1001',
  scheduled_kickoff_at: new Date('2026-05-01T18:00:00Z'),
  home_team_id: '10',
  away_team_id: '20',
  competition_edition_id: '147',
};
const NOW = new Date('2026-09-01T00:00:00Z');

describe('edition scope reaches the fixture-eligibility query', () => {
  test('with --edition: the query carries the ANY predicate + the edition id param', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const tx = captureTx([FIXTURE_ROW], calls);
    await selectBatches(tx, mockRegistry(), NOW, {
      replayFrom: new Date('2026-01-28T00:00:00Z'),
      replayTo: new Date('2026-09-20T00:00:00Z'),
      competitionEditionIds: ['147', '18'],
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /competition_edition_id = ANY\(\$3::bigint\[\]\)/);
    assert.deepEqual(calls[0].params[2], ['147', '18']);
  });
  test('without --edition: no ANY predicate, only the two range params (unscoped unchanged)', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const tx = captureTx([FIXTURE_ROW], calls);
    await selectBatches(tx, mockRegistry(), NOW, {
      replayFrom: new Date('2026-01-28T00:00:00Z'),
      replayTo: new Date('2026-09-20T00:00:00Z'),
    });
    assert.doesNotMatch(calls[0].sql, /competition_edition_id = ANY/);
    assert.equal(calls[0].params.length, 2);
  });
  test('batch derivation (team+as_of) is unaffected by the edition filter', async () => {
    const tx = captureTx([FIXTURE_ROW], []);
    const batches = await selectBatches(tx, mockRegistry(), NOW, {
      replayFrom: new Date('2026-01-28T00:00:00Z'),
      replayTo: new Date('2026-09-20T00:00:00Z'),
      competitionEditionIds: ['147'],
    });
    assert.equal(batches.length, 1);                      // one as_of (KICKOFF, offset 0)
    assert.deepEqual([...batches[0].teamIds], ['10', '20']); // both participants
  });
});

// ── structural invariants ────────────────────────────────────────────────────────

describe('scope never widens blast radius', () => {
  test('the squad-stability historical lineup read takes no edition filter (cross-competition)', () => {
    // The edition filter lives ONLY in readFixturesForEligibility (which fixtures
    // GENERATE work). The lineup evidence read must stay team+as_of, so a per-edition
    // replay still sees a team's XIs across all competitions.
    const lineups = readFileSync(join(HERE, '..', 'read', 'lineups.ts'), 'utf8');
    assert.doesNotMatch(lineups, /competition_edition_id/);
  });
  test('the feature replay path imports no module/snapshot/calibration/provider code', () => {
    for (const rel of ['cli.ts', 'pipeline.ts', 'driver/eligibility.ts']) {
      const src = readFileSync(join(HERE, '..', rel), 'utf8');
      assert.doesNotMatch(src, /from '\.\.?\/(module|snapshot|calibration)\//, `${rel} must not import a downstream stage`);
      assert.doesNotMatch(src, /ingestion\/provider/, `${rel} must not import the provider client`);
    }
  });
});
