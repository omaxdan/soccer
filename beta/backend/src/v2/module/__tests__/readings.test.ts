// MODULE READING READ-SURFACE TESTS (Phase B.1).
//
// Two layers, per the repo convention:
//   • DB-free unit tests: the current-reading SQL shape (DISTINCT ON, filters,
//     ordering), row mapping/coercion, and param binding — with a capture tx.
//   • DB-gated integration (skip without PT_V2_DB_*): produces REAL readings for
//     the two ACTIVE modules using the SAME production functions the module
//     pipeline uses (readConsumedFeatures → assembleReading → writeReading), then
//     proves the NEW read surface returns them, corresponds to the actual rows,
//     honours current-reading semantics, and filters by team / module / edition.
//     module.module_reading is NOT mocked — it is written by real production code.

import { after, before, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  readCurrentTeamReadings,
  readActiveMatchReadings,
  mapReadingRow,
  CURRENT_TEAM_READINGS_SQL,
  ACTIVE_MODULE_KEYS,
} from '../read/readings';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';

import { loadRegistry } from '../../feature/registry/load';
import { writeValues } from '../../feature/write/values';
import {
  COMPETITION_SCOPED_CONTEXT_KIND,
  ALL_COMPETITIONS_SCOPE,
  type CalculationScope,
} from '../../feature/calculators/types';
import { fromInt } from '../../feature/write/scale';
import { homeAwaySplit } from '../calculators/homeAwaySplit';
import { readinessTracker } from '../calculators/readinessTracker';
import { assembleReading, runModulePipeline } from '../pipeline';
import { loadModuleRegistry, resolveModuleVersion } from '../registry/load';
import { readConsumedFeatures, consumedKey } from '../read/consumedFeatures';
import { writeReading } from '../write/readings';
import type { ModuleCalculator } from '../types';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);

// ─────────────────────────────────────────────────────────────────────────────
// DB-FREE: SQL shape, mapping, param binding
// ─────────────────────────────────────────────────────────────────────────────
function captureTx(rows: unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const tx = {
    query: async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      return { rows };
    },
  } as unknown as PoolClient;
  return { tx, calls };
}

const sampleRow = {
  module_key: 'home_away_split',
  team_id: '18',
  context_kind_code: 'COMPETITION_SCOPED',
  context_competition_edition_id: '42',
  as_of: new Date('2027-06-01T00:00:00Z'),
  calculated_at: new Date('2027-06-01T01:00:00Z'),
  module_status_code: 'SUPPORTS',
  strength: '12.50',
  confidence: null,
  sample_observation_count: 6,
  sample_meets_threshold: true,
  verdict_text: 'home fortress',
  inactive_reason: null,
};

describe('module readings · current-reading SQL shape', () => {
  test('the SQL selects the latest reading per (team, module, context)', () => {
    // DISTINCT ON group + descending as_of ordering = "current reading", deterministic.
    assert.match(CURRENT_TEAM_READINGS_SQL, /DISTINCT ON \(mr\.subject_team_id, mr\.module_definition_id, mr\.context_kind_code, mr\.context_competition_edition_id\)/);
    assert.match(CURRENT_TEAM_READINGS_SQL, /ORDER BY[\s\S]*mr\.as_of DESC, mr\.calculated_at DESC, mr\.id DESC/);
    // schema-qualified, joins definition for module identity, TEAM subjects only
    assert.match(CURRENT_TEAM_READINGS_SQL, /FROM module\.module_reading mr/);
    assert.match(CURRENT_TEAM_READINGS_SQL, /JOIN module\.module_definition md/);
    assert.match(CURRENT_TEAM_READINGS_SQL, /mr\.subject_kind_code = 'TEAM'/);
    // team filter, as_of ceiling, optional module + context filters
    assert.match(CURRENT_TEAM_READINGS_SQL, /mr\.subject_team_id = ANY\(\$1::bigint\[\]\)/);
    assert.match(CURRENT_TEAM_READINGS_SQL, /mr\.as_of <= \$2::timestamptz/);
    assert.match(CURRENT_TEAM_READINGS_SQL, /\$3::text\[\] IS NULL OR md\.module_key = ANY\(\$3::text\[\]\)/);
    assert.match(CURRENT_TEAM_READINGS_SQL, /context_competition_edition_id IS NULL[\s\S]*\$4::bigint IS NULL[\s\S]*= \$4::bigint/);
    // read-only
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(CURRENT_TEAM_READINGS_SQL));
  });

  test('mapReadingRow coerces numeric/bigint text and preserves nulls', () => {
    const r = mapReadingRow(sampleRow as any);
    assert.deepEqual(r, {
      moduleKey: 'home_away_split', teamId: '18', contextKindCode: 'COMPETITION_SCOPED',
      contextCompetitionEditionId: '42', asOf: sampleRow.as_of, calculatedAt: sampleRow.calculated_at,
      moduleStatusCode: 'SUPPORTS', strength: 12.5, confidence: null, sampleObservationCount: 6,
      sampleMeetsThreshold: true, verdictText: 'home fortress', inactiveReason: null,
    });
  });

  test('empty teamIds short-circuits without a query', async () => {
    const { tx, calls } = captureTx([]);
    const r = await readCurrentTeamReadings(tx, { teamIds: [] });
    assert.deepEqual(r, []);
    assert.equal(calls.length, 0);
  });

  test('binds team ids, as_of ceiling, module keys and context edition', async () => {
    const { tx, calls } = captureTx([sampleRow]);
    const asOf = new Date('2027-06-02T00:00:00Z');
    const out = await readCurrentTeamReadings(tx, { teamIds: ['18', '19'], asOf, moduleKeys: ['home_away_split'], contextCompetitionEditionId: '42' });
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].params, [['18', '19'], asOf, ['home_away_split'], '42']);
    assert.equal(out.length, 1);
    assert.equal(out[0].moduleKey, 'home_away_split');
  });

  test('omitted module keys / context bind as null (no filter)', async () => {
    const { tx, calls } = captureTx([]);
    await readCurrentTeamReadings(tx, { teamIds: ['18'] });
    assert.equal(calls[0].params[2], null, 'module keys → null');
    assert.equal(calls[0].params[3], null, 'context edition → null');
    assert.ok(calls[0].params[1] instanceof Date, 'as_of defaults to a Date (now)');
  });

  test('readActiveMatchReadings requests both teams, the two active modules, and the edition', async () => {
    const { tx, calls } = captureTx([]);
    await readActiveMatchReadings(tx, { homeTeamId: '18', awayTeamId: '19', competitionEditionId: '42' });
    assert.deepEqual(calls[0].params[0], ['18', '19']);
    assert.deepEqual(calls[0].params[2], [...ACTIVE_MODULE_KEYS]);
    assert.equal(calls[0].params[3], '42');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB-GATED: real readings via the production module functions, then the surface
// ─────────────────────────────────────────────────────────────────────────────
describe('module readings · read surface over real readings (requires a V2 database)', { skip: !hasDatabase }, () => {
  const HOME_WIN_RATE = 'team.home_win_rate';
  const AWAY_WIN_RATE = 'team.away_win_rate';
  const MOMENTUM = 'team.momentum';
  // Run-UNIQUE as_of window, safely after the seed-time version effective start,
  // so this test never collides with its own residue on a reused database
  // (module_reading is append-only). The football world is isolated per run too.
  const RUN_BASE = Date.UTC(2027, 5, 1) + (Date.now() % 20_000_000) * 60_000; // minutes of jitter
  const AS_OF = new Date(RUN_BASE);
  const LATER = new Date(RUN_BASE + 30 * 86_400_000);   // to prove "current reading" = latest
  const CEILING = new Date(RUN_BASE + 60 * 86_400_000);
  const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
  const FEATURE_ROLE = 'pt_pipeline_feature' as const;
  const MODULE_ROLE = 'pt_pipeline_module' as const;

  // A fully ISOLATED football world (unique provider ids), so no sibling test's
  // feature values or readings can perturb readConsumedFeatures / the read surface.
  const TAG = String(Date.now() % 1_000_000);
  let editionId = '';
  let teamAId = '';
  let teamBId = '';

  async function seedIsolatedWorld(tx: PoolClient): Promise<void> {
    const comp = await tx.query<{ id: string }>(
      `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
       VALUES ('SPORTSAPI_API', $1, 'B1 Read League', $2, 'GB')
       ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id::text`, [`B1RD-COMP-${TAG}`, `b1rd-league-${TAG}`]);
    const ed = await tx.query<{ id: string }>(
      `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
       VALUES ($1, $2, 'B1RD 2026', daterange('2026-01-01','2027-01-01'))
       ON CONFLICT (provider_external_id) DO UPDATE SET season_label = EXCLUDED.season_label
       RETURNING id::text`, [comp.rows[0].id, `B1RD-S-${TAG}`]);
    editionId = ed.rows[0].id;
    const team = async (suffix: string) => (await tx.query<{ id: string }>(
      `INSERT INTO football.team (provider_code, provider_external_id, name, slug)
       VALUES ('SPORTSAPI_API', $1, $2, $3)
       ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET name = EXCLUDED.name
       RETURNING id::text`, [`B1RD-T${suffix}-${TAG}`, `B1RD Team ${suffix}`, `b1rd-team-${suffix}-${TAG}`])).rows[0].id;
    teamAId = await team('A');
    teamBId = await team('B');
  }

  const scoped = (edId: string): CalculationScope => ({ contextKind: COMPETITION_SCOPED_CONTEXT_KIND, contextEditionId: edId });

  /** Persist one reading using the exact production path the module pipeline uses. */
  async function produceReading(tx: PoolClient, moduleKey: string, calculator: ModuleCalculator, teamId: string, scope: CalculationScope, asOf: Date) {
    const registry = await loadModuleRegistry(tx);
    const def = registry.definitionsByKey.get(moduleKey)!;
    const version = await resolveModuleVersion(tx, def.moduleDefinitionId, asOf);
    assert.ok(version, `a module version must cover ${asOf.toISOString()} for ${moduleKey}`);
    const consumed = await readConsumedFeatures(tx, calculator.inputFeatureKeys, [teamId], asOf, scope);
    const inputs = new Map();
    for (const k of calculator.inputFeatureKeys) {
      const v = consumed.get(consumedKey(k, teamId));
      if (v) inputs.set(k, v);
    }
    const reading = assembleReading({ calculator, definition: def, version: version!, asOf, scope, teamId, inputs });
    await writeReading(tx, { ...reading, calculatedAt: asOf });
    return reading;
  }

  before(async () => {
    await withConnection(INGESTION_ROLE, (tx) => seedIsolatedWorld(tx));
    // Feature values (real writer) for both active modules' inputs, at AS_OF.
    await withConnection(FEATURE_ROLE, async (tx) => {
      const registry = await loadRegistry(tx);
      const scv = scoped(editionId);
      // home_away_split inputs — a clear disparity for A, balance for B.
      await writeValues(tx, registry, [
        { featureKey: HOME_WIN_RATE, teamId: teamAId, asOf: AS_OF, value: fromInt(80), sampleObservationCount: 8, consumed: [] },
        { featureKey: AWAY_WIN_RATE, teamId: teamAId, asOf: AS_OF, value: fromInt(20), sampleObservationCount: 8, consumed: [] },
        { featureKey: HOME_WIN_RATE, teamId: teamBId, asOf: AS_OF, value: fromInt(50), sampleObservationCount: 8, consumed: [] },
        { featureKey: AWAY_WIN_RATE, teamId: teamBId, asOf: AS_OF, value: fromInt(50), sampleObservationCount: 8, consumed: [] },
      ], AS_OF, scv);
      // readiness_tracker input — team momentum (ALL_COMPETITIONS).
      await writeValues(tx, registry, [
        { featureKey: MOMENTUM, teamId: teamAId, asOf: AS_OF, value: fromInt(15), sampleObservationCount: 8, consumed: [] },
        { featureKey: MOMENTUM, teamId: teamBId, asOf: AS_OF, value: fromInt(-5), sampleObservationCount: 8, consumed: [] },
      ], AS_OF);
    });
    // Produce readings via the production path (both modules × both teams) at AS_OF.
    await withConnection(MODULE_ROLE, async (tx) => {
      for (const teamId of [teamAId, teamBId]) {
        await produceReading(tx, 'home_away_split', homeAwaySplit, teamId, scoped(editionId), AS_OF);
        await produceReading(tx, 'readiness_tracker', readinessTracker, teamId, ALL_COMPETITIONS_SCOPE, AS_OF);
      }
    });
  });

  after(async () => {
    await closeAllPools();
  });

  it('runModulePipeline (the production entry the CLI wraps) runs and reports the two active modules', async () => {
    const report = await runModulePipeline({ dryRun: true, replayFrom: AS_OF, replayTo: CEILING });
    assert.deepEqual([...report.modules].sort(), ['home_away_split', 'readiness_tracker']);
    assert.equal(report.failures, 0);
  });

  it('the read surface returns both active modules for both teams of the fixture', async () => {
    const readings = await withConnection(MODULE_ROLE, (tx) =>
      readActiveMatchReadings(tx, { homeTeamId: teamAId, awayTeamId: teamBId, competitionEditionId: editionId, asOf: CEILING }));
    const pairs = readings.map((r) => `${r.moduleKey}:${r.teamId}`).sort();
    assert.deepEqual(pairs, [
      `home_away_split:${teamAId}`, `home_away_split:${teamBId}`,
      `readiness_tracker:${teamAId}`, `readiness_tracker:${teamBId}`,
    ].sort());
    // readiness is ALL_COMPETITIONS (no edition); home_away is scoped to the edition.
    for (const r of readings) {
      if (r.moduleKey === 'readiness_tracker') assert.equal(r.contextCompetitionEditionId, null);
      if (r.moduleKey === 'home_away_split') assert.equal(r.contextCompetitionEditionId, editionId);
    }
  });

  it('returned values correspond to the actual module_reading rows (not just row existence)', async () => {
    const [surface, direct] = await withConnection(MODULE_ROLE, async (tx) => {
      const s = await readCurrentTeamReadings(tx, { teamIds: [teamAId], asOf: CEILING, moduleKeys: ['home_away_split'], contextCompetitionEditionId: editionId });
      const d = await tx.query(
        `SELECT mr.module_status_code, mr.sample_observation_count, mr.sample_meets_threshold, mr.as_of, mr.verdict_text
           FROM module.module_reading mr JOIN module.module_definition md ON md.id = mr.module_definition_id
          WHERE md.module_key = 'home_away_split' AND mr.subject_team_id = $1
            AND mr.context_competition_edition_id = $2
          ORDER BY mr.as_of DESC, mr.calculated_at DESC, mr.id DESC LIMIT 1`,
        [teamAId, editionId]);
      return [s, d.rows[0] as any];
    });
    assert.equal(surface.length, 1);
    const r = surface[0];
    assert.equal(r.moduleStatusCode, direct.module_status_code);
    assert.equal(r.sampleObservationCount, Number(direct.sample_observation_count));
    assert.equal(r.sampleMeetsThreshold, direct.sample_meets_threshold);
    assert.equal(r.asOf.getTime(), new Date(direct.as_of).getTime());
    assert.equal(r.verdictText, direct.verdict_text);
    // Alpha has an 80/20 home/away disparity → the module found a real signal.
    assert.equal(r.moduleStatusCode, 'SUPPORTS');
    assert.ok(r.sampleObservationCount >= 1);
  });

  it('current-reading semantics: a later as_of supersedes the earlier one', async () => {
    // Write a second, later reading for alpha home_away_split.
    await withConnection(MODULE_ROLE, (tx) => produceReading(tx, 'home_away_split', homeAwaySplit, teamAId, scoped(editionId), LATER));
    const readings = await withConnection(MODULE_ROLE, (tx) =>
      readCurrentTeamReadings(tx, { teamIds: [teamAId], asOf: CEILING, moduleKeys: ['home_away_split'], contextCompetitionEditionId: editionId }));
    assert.equal(readings.length, 1, 'still one current reading per (team, module, context)');
    assert.equal(readings[0].asOf.getTime(), LATER.getTime(), 'the later reading is the current one');
  });

  it('as_of ceiling excludes readings after the requested moment', async () => {
    const readings = await withConnection(MODULE_ROLE, (tx) =>
      readCurrentTeamReadings(tx, { teamIds: [teamAId], asOf: AS_OF, moduleKeys: ['home_away_split'], contextCompetitionEditionId: editionId }));
    assert.equal(readings.length, 1);
    assert.equal(readings[0].asOf.getTime(), AS_OF.getTime(), 'the LATER reading is excluded by the ceiling');
  });

  it('sample-count semantics: sample_meets_threshold agrees with sample vs the version minimum', async () => {
    const [surface, minimum] = await withConnection(MODULE_ROLE, async (tx) => {
      const s = await readCurrentTeamReadings(tx, { teamIds: [teamAId], asOf: CEILING, moduleKeys: ['readiness_tracker'] });
      const m = await tx.query<{ min: number }>(
        `SELECT v.minimum_sample_observation_count::int AS min
           FROM module.module_version v JOIN module.module_definition d ON d.id = v.module_definition_id
          WHERE d.module_key = 'readiness_tracker' AND v.effective_period @> $1::timestamptz`, [AS_OF]);
      return [s, m.rows[0].min];
    });
    assert.equal(surface.length, 1);
    const r = surface[0];
    assert.equal(r.sampleMeetsThreshold, r.sampleObservationCount >= minimum, 'threshold flag matches sample vs version minimum');
  });

  it('edition filter: a different edition returns only ALL_COMPETITIONS readings', async () => {
    const readings = await withConnection(MODULE_ROLE, (tx) =>
      readActiveMatchReadings(tx, { homeTeamId: teamAId, awayTeamId: teamBId, competitionEditionId: '999999999', asOf: CEILING }));
    // No home_away_split for a non-matching edition; readiness (ALL_COMPETITIONS) still present.
    assert.ok(readings.every((r) => r.moduleKey !== 'home_away_split'), 'scoped readings of another edition are excluded');
    assert.ok(readings.some((r) => r.moduleKey === 'readiness_tracker'), 'ALL_COMPETITIONS readings remain visible');
  });
});
