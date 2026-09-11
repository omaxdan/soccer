// MODULE EVIDENCE READ-SURFACE TESTS (Phase C.2).
//
// DB-free: the current-reading-evidence SQL shape (DISTINCT ON current, INACTIVE
// excluded, the evidence/item/value/definition joins, as_of ceiling, filters,
// read-only), the pure row→ReadingEvidence grouping (set-level counts, one item
// per cited value, direction carried verbatim, zero counts and zero values
// preserved, an unresolved cited value kept null, an item-less evidence set kept),
// empty short-circuit and param binding.
//
// DB-gated (skip without PT_V2_DB_*): REAL readings and their evidence produced by
// the SAME production path the module pipeline uses (readConsumedFeatures →
// assembleReading → writeReading) over an isolated football world, then read
// THROUGH the new surface and proven to correspond EXACTLY to the persisted
// module_evidence / module_evidence_item rows. module.module_evidence* is NOT
// mocked. Covers SUPPORTS / CONTRADICTS / NEUTRAL, a zero-valued input preserved,
// an INACTIVE reading yielding no evidence, and evidence tracking the current
// reading across as_of.

import { after, before, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  readCurrentReadingEvidence,
  mapEvidenceRows,
  CURRENT_READING_EVIDENCE_SQL,
} from '../read/evidence';
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
import { assembleReading } from '../pipeline';
import { loadModuleRegistry, resolveModuleVersion } from '../registry/load';
import { readConsumedFeatures, consumedKey } from '../read/consumedFeatures';
import { writeReading } from '../write/readings';
import type { ModuleCalculator } from '../types';

import { testDatabaseReady } from '../../db/testSupport';
const hasDatabase = testDatabaseReady();

// ─────────────────────────────────────────────────────────────────────────────
// DB-FREE
// ─────────────────────────────────────────────────────────────────────────────
function captureTx(rows: unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const tx = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows }; } } as unknown as PoolClient;
  return { tx, calls };
}

/** One flat (reading × item) row as the SQL returns it. */
const row = (over: Partial<Record<string, unknown>> = {}) => ({
  module_key: 'home_away_split', team_id: '18',
  context_kind_code: 'COMPETITION_SCOPED', context_competition_edition_id: '42',
  declared_input_count: 2, present_input_count: 2,
  below_threshold_input_count: 0, estimated_input_count: 0,
  contribution_direction: 'SUPPORTS', cited_feature_key: 'team.home_win_rate',
  cited_display_name: 'Home win rate', cited_value: '80', cited_as_of: new Date('2027-06-01T00:00:00Z'),
  ...over,
});

describe('module evidence · SQL shape', () => {
  test('selects the current ENGAGED reading and joins its evidence, items, cited value and definition', () => {
    assert.match(CURRENT_READING_EVIDENCE_SQL, /DISTINCT ON \(mr\.subject_team_id, mr\.module_definition_id, mr\.context_kind_code, mr\.context_competition_edition_id\)/);
    assert.match(CURRENT_READING_EVIDENCE_SQL, /ORDER BY[\s\S]*mr\.as_of DESC, mr\.calculated_at DESC, mr\.id DESC/);
    // INACTIVE readings are excluded at the source — they recorded no evidence.
    assert.match(CURRENT_READING_EVIDENCE_SQL, /mr\.module_status_code <> 'INACTIVE'/);
    // the join path: reading → evidence (1:1) → item (1:N) → feature value → definition
    assert.match(CURRENT_READING_EVIDENCE_SQL, /JOIN module\.module_evidence me/);
    assert.match(CURRENT_READING_EVIDENCE_SQL, /LEFT JOIN module\.module_evidence_item mei/);
    assert.match(CURRENT_READING_EVIDENCE_SQL, /LEFT JOIN feature\.feature_value fv/);
    assert.match(CURRENT_READING_EVIDENCE_SQL, /LEFT JOIN feature\.feature_definition d/);
    // ceiling, team, module and context filters
    assert.match(CURRENT_READING_EVIDENCE_SQL, /mr\.subject_team_id = ANY\(\$1::bigint\[\]\)/);
    assert.match(CURRENT_READING_EVIDENCE_SQL, /mr\.as_of <= \$2::timestamptz/);
    assert.match(CURRENT_READING_EVIDENCE_SQL, /\$3::text\[\] IS NULL OR md\.module_key = ANY\(\$3::text\[\]\)/);
    assert.match(CURRENT_READING_EVIDENCE_SQL, /context_competition_edition_id IS NULL[\s\S]*\$4::bigint IS NULL[\s\S]*= \$4::bigint/);
    // read-only
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(CURRENT_READING_EVIDENCE_SQL));
  });
});

describe('module evidence · row grouping (mapEvidenceRows)', () => {
  test('one reading with complete evidence: set-level counts + one item', () => {
    const out = mapEvidenceRows([row()] as any);
    assert.equal(out.length, 1);
    assert.deepEqual(
      { ...out[0], items: undefined },
      {
        moduleKey: 'home_away_split', teamId: '18', contextKindCode: 'COMPETITION_SCOPED',
        contextCompetitionEditionId: '42', declaredInputCount: 2, presentInputCount: 2,
        belowThresholdInputCount: 0, estimatedInputCount: 0, items: undefined,
      }
    );
    assert.deepEqual(out[0].items, [{
      featureKey: 'team.home_win_rate', displayName: 'Home win rate', value: 80,
      asOf: new Date('2027-06-01T00:00:00Z'), contributionDirection: 'SUPPORTS',
    }]);
  });

  test('multiple items collapse under one reading (1:N)', () => {
    const out = mapEvidenceRows([
      row({ cited_feature_key: 'team.home_win_rate', cited_display_name: 'Home win rate', cited_value: '80' }),
      row({ cited_feature_key: 'team.away_win_rate', cited_display_name: 'Away win rate', cited_value: '20' }),
    ] as any);
    assert.equal(out.length, 1, 'still one reading');
    assert.equal(out[0].items.length, 2);
    assert.deepEqual(out[0].items.map((i) => i.featureKey), ['team.home_win_rate', 'team.away_win_rate']);
    assert.deepEqual(out[0].items.map((i) => i.value), [80, 20]);
  });

  test('each contribution direction is carried through verbatim (SUPPORTS / CONTRADICTS / NEUTRAL)', () => {
    for (const dir of ['SUPPORTS', 'CONTRADICTS', 'NEUTRAL'] as const) {
      const out = mapEvidenceRows([row({ contribution_direction: dir })] as any);
      assert.equal(out[0].items[0].contributionDirection, dir);
    }
  });

  test('zero below-threshold / estimated counts are preserved as 0', () => {
    const out = mapEvidenceRows([row({ below_threshold_input_count: 0, estimated_input_count: 0 })] as any);
    assert.equal(out[0].belowThresholdInputCount, 0);
    assert.equal(out[0].estimatedInputCount, 0);
  });

  test('non-zero below-threshold / estimated counts are preserved exactly', () => {
    const out = mapEvidenceRows([row({ below_threshold_input_count: 1, estimated_input_count: 2 })] as any);
    assert.equal(out[0].belowThresholdInputCount, 1);
    assert.equal(out[0].estimatedInputCount, 2);
  });

  test('a zero-valued cited feature value stays 0 (never dropped as falsy)', () => {
    const out = mapEvidenceRows([row({ cited_value: '0', contribution_direction: 'NEUTRAL' })] as any);
    assert.equal(out[0].items[0].value, 0);
    assert.notEqual(out[0].items[0].value, null);
  });

  test('an unresolved cited value stays null (never fabricated)', () => {
    const out = mapEvidenceRows([row({ cited_value: null, cited_feature_key: null, cited_display_name: null, cited_as_of: null })] as any);
    assert.equal(out[0].items[0].value, null);
    assert.equal(out[0].items[0].featureKey, null);
    assert.equal(out[0].items[0].asOf, null);
    assert.equal(out[0].items[0].contributionDirection, 'SUPPORTS');
  });

  test('an evidence set with no item row keeps its counts and an empty items list', () => {
    const out = mapEvidenceRows([row({ contribution_direction: null, cited_feature_key: null, cited_display_name: null, cited_value: null, cited_as_of: null })] as any);
    assert.equal(out.length, 1);
    assert.equal(out[0].declaredInputCount, 2);
    assert.deepEqual(out[0].items, []);
  });

  test('no rows → no evidence (missing evidence is absence, never a fabricated block)', () => {
    assert.deepEqual(mapEvidenceRows([]), []);
  });

  test('numeric/bigint text coerces; integer counts pass through', () => {
    const out = mapEvidenceRows([row({ declared_input_count: '2', present_input_count: '2', cited_value: '73.5' })] as any);
    assert.equal(out[0].declaredInputCount, 2);
    assert.equal(out[0].presentInputCount, 2);
    assert.equal(out[0].items[0].value, 73.5);
  });
});

describe('module evidence · read function (DB-free)', () => {
  test('empty teamIds short-circuits with no query', async () => {
    const { tx, calls } = captureTx([]);
    assert.deepEqual(await readCurrentReadingEvidence(tx, { teamIds: [] }), []);
    assert.equal(calls.length, 0);
  });

  test('binds team ids, as_of ceiling, module keys and context edition', async () => {
    const { tx, calls } = captureTx([row()]);
    const asOf = new Date('2027-06-02T00:00:00Z');
    const out = await readCurrentReadingEvidence(tx, { teamIds: ['18', '19'], asOf, moduleKeys: ['home_away_split'], contextCompetitionEditionId: '42' });
    assert.deepEqual(calls[0].params, [['18', '19'], asOf, ['home_away_split'], '42']);
    assert.equal(out[0].moduleKey, 'home_away_split');
  });

  test('omitted module keys / context bind as null (no filter)', async () => {
    const { tx, calls } = captureTx([]);
    await readCurrentReadingEvidence(tx, { teamIds: ['18'] });
    assert.equal(calls[0].params[2], null);
    assert.equal(calls[0].params[3], null);
    assert.ok(calls[0].params[1] instanceof Date, 'as_of defaults to now');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB-GATED
// ─────────────────────────────────────────────────────────────────────────────
describe('module evidence · over real module_evidence (requires a V2 database)', { skip: !hasDatabase }, () => {
  const HOME_WIN_RATE = 'team.home_win_rate';
  const AWAY_WIN_RATE = 'team.away_win_rate';
  const MOMENTUM = 'team.momentum';
  const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
  const FEATURE_ROLE = 'pt_pipeline_feature' as const;
  const MODULE_ROLE = 'pt_pipeline_module' as const;
  const TAG = String(Date.now() % 1_000_000);
  // Run-unique window, safely after the seed-time version effective start; the
  // football world is isolated per run (unique provider ids).
  const RUN_BASE = Date.UTC(2027, 5, 1) + (Date.now() % 20_000_000) * 60_000;
  const AS_OF = new Date(RUN_BASE);
  const LATER = new Date(RUN_BASE + 30 * 86_400_000);
  const CEILING = new Date(RUN_BASE + 60 * 86_400_000);

  let editionId = '', teamA = '', teamB = '', teamC = '';
  const scoped = (ed: string): CalculationScope => ({ contextKind: COMPETITION_SCOPED_CONTEXT_KIND, contextEditionId: ed });

  async function seedWorld(tx: PoolClient) {
    const comp = await tx.query<{ id: string }>(
      `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
       VALUES ('SPORTSAPI_API',$1,'C2 League',$2,'GB')
       ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET name=EXCLUDED.name RETURNING id::text`,
      [`C2E-COMP-${TAG}`, `c2e-league-${TAG}`]);
    const ed = await tx.query<{ id: string }>(
      `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
       VALUES ($1,$2,'C2E 2026', daterange('2026-01-01','2028-01-01'))
       ON CONFLICT (provider_external_id) DO UPDATE SET season_label=EXCLUDED.season_label RETURNING id::text`,
      [comp.rows[0].id, `C2E-S-${TAG}`]);
    editionId = ed.rows[0].id;
    const team = async (s: string) => (await tx.query<{ id: string }>(
      `INSERT INTO football.team (provider_code, provider_external_id, name, slug)
       VALUES ('SPORTSAPI_API',$1,$2,$3)
       ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET name=EXCLUDED.name RETURNING id::text`,
      [`C2E-T${s}-${TAG}`, `C2E ${s}`, `c2e-${s}-${TAG}`])).rows[0].id;
    teamA = await team('A'); teamB = await team('B'); teamC = await team('C');
  }

  async function produceReading(tx: PoolClient, moduleKey: string, calc: ModuleCalculator, teamId: string, scope: CalculationScope, asOf: Date) {
    const registry = await loadModuleRegistry(tx);
    const def = registry.definitionsByKey.get(moduleKey)!;
    const version = await resolveModuleVersion(tx, def.moduleDefinitionId, asOf);
    const consumed = await readConsumedFeatures(tx, calc.inputFeatureKeys, [teamId], asOf, scope);
    const inputs = new Map();
    for (const k of calc.inputFeatureKeys) { const v = consumed.get(consumedKey(k, teamId)); if (v) inputs.set(k, v); }
    const reading = assembleReading({ calculator: calc, definition: def, version: version!, asOf, scope, teamId, inputs });
    await writeReading(tx, { ...reading, calculatedAt: asOf });
    return reading;
  }

  before(async () => {
    await withConnection(INGESTION_ROLE, (tx) => seedWorld(tx));
    await withConnection(FEATURE_ROLE, async (tx) => {
      const reg = await loadRegistry(tx);
      // A: strong home/away disparity (SUPPORTS) + rising momentum (SUPPORTS).
      // B: balanced venues (NEUTRAL) + crashing momentum (CONTRADICTS).
      await writeValues(tx, reg, [
        { featureKey: HOME_WIN_RATE, teamId: teamA, asOf: AS_OF, value: fromInt(80), sampleObservationCount: 8, consumed: [] },
        { featureKey: AWAY_WIN_RATE, teamId: teamA, asOf: AS_OF, value: fromInt(20), sampleObservationCount: 8, consumed: [] },
        { featureKey: HOME_WIN_RATE, teamId: teamB, asOf: AS_OF, value: fromInt(50), sampleObservationCount: 8, consumed: [] },
        { featureKey: AWAY_WIN_RATE, teamId: teamB, asOf: AS_OF, value: fromInt(50), sampleObservationCount: 8, consumed: [] },
      ], AS_OF, scoped(editionId));
      await writeValues(tx, reg, [
        { featureKey: MOMENTUM, teamId: teamA, asOf: AS_OF, value: fromInt(15), sampleObservationCount: 10, consumed: [] },
        { featureKey: MOMENTUM, teamId: teamB, asOf: AS_OF, value: fromInt(-12), sampleObservationCount: 10, consumed: [] },
        // C: momentum exactly 0 → STABLE → NEUTRAL, and the zero value must survive.
        { featureKey: MOMENTUM, teamId: teamC, asOf: AS_OF, value: fromInt(0), sampleObservationCount: 10, consumed: [] },
        // C deliberately has NO win rates → home_away_split is INACTIVE for C.
      ], AS_OF);
    });
    await withConnection(MODULE_ROLE, async (tx) => {
      await produceReading(tx, 'home_away_split', homeAwaySplit, teamA, scoped(editionId), AS_OF);
      await produceReading(tx, 'home_away_split', homeAwaySplit, teamB, scoped(editionId), AS_OF);
      await produceReading(tx, 'home_away_split', homeAwaySplit, teamC, scoped(editionId), AS_OF); // → INACTIVE
      await produceReading(tx, 'readiness_tracker', readinessTracker, teamA, ALL_COMPETITIONS_SCOPE, AS_OF);
      await produceReading(tx, 'readiness_tracker', readinessTracker, teamB, ALL_COMPETITIONS_SCOPE, AS_OF);
      await produceReading(tx, 'readiness_tracker', readinessTracker, teamC, ALL_COMPETITIONS_SCOPE, AS_OF);
    });
  });
  after(async () => { await closeAllPools(); });

  it('surfaces evidence that corresponds EXACTLY to the persisted module_evidence / item rows', async () => {
    const { surface, direct } = await withConnection(MODULE_ROLE, async (tx) => {
      const s = await readCurrentReadingEvidence(tx, {
        teamIds: [teamA, teamB], asOf: CEILING,
        moduleKeys: ['home_away_split', 'readiness_tracker'], contextCompetitionEditionId: editionId,
      });
      // Authoritative: the persisted evidence items for these teams' current readings.
      const d = await tx.query<{ module_key: string; team: string; declared: string; present: string; dir: string; fkey: string; val: string }>(
        `SELECT md.module_key, mr.subject_team_id::text team,
                me.declared_input_count::text declared, me.present_input_count::text present,
                mei.contribution_direction dir, fd.feature_key fkey, fv.value::text val
           FROM module.module_reading mr
           JOIN module.module_definition md ON md.id = mr.module_definition_id
           JOIN module.module_evidence me ON me.module_reading_id = mr.id AND me.reading_as_of = mr.as_of
           JOIN module.module_evidence_item mei ON mei.module_evidence_id = me.id AND mei.reading_as_of = me.reading_as_of
           JOIN feature.feature_value fv ON fv.id = mei.cited_feature_value_id AND fv.as_of = mei.cited_feature_value_as_of
           JOIN feature.feature_definition fd ON fd.id = fv.feature_definition_id
          WHERE mr.subject_team_id = ANY($1::bigint[]) AND mr.module_status_code <> 'INACTIVE'
          ORDER BY md.module_key, mr.subject_team_id, fd.feature_key`,
        [[teamA, teamB]]);
      return { surface: s, direct: d.rows };
    });

    // Every persisted item appears in the surface with the same value and direction.
    const flat = surface.flatMap((e) => e.items.map((i) => ({ module: e.moduleKey, team: e.teamId, dir: i.contributionDirection, fkey: i.featureKey, val: i.value })));
    assert.equal(flat.length, direct.length, 'surface item count equals persisted item count');
    for (const d of direct) {
      const m = flat.find((f) => f.module === d.module_key && f.team === d.team && f.fkey === d.fkey);
      assert.ok(m, `surface has ${d.module_key}/${d.team}/${d.fkey}`);
      assert.equal(m!.dir, d.dir, 'direction corresponds to persisted');
      assert.equal(m!.val, Number(d.val), 'value corresponds to persisted');
    }

    // A: home_away SUPPORTS (2 items 80/20), readiness SUPPORTS (1 item, 15).
    const aHa = surface.find((e) => e.teamId === teamA && e.moduleKey === 'home_away_split')!;
    assert.equal(aHa.declaredInputCount, 2);
    assert.equal(aHa.presentInputCount, 2);
    assert.equal(aHa.items.length, 2);
    assert.ok(aHa.items.every((i) => i.contributionDirection === 'SUPPORTS'));
    assert.deepEqual(aHa.items.map((i) => i.value).sort((x, y) => x! - y!), [20, 80]);
    const aRt = surface.find((e) => e.teamId === teamA && e.moduleKey === 'readiness_tracker')!;
    assert.equal(aRt.items.length, 1);
    assert.equal(aRt.items[0].contributionDirection, 'SUPPORTS');
    assert.equal(aRt.items[0].value, 15);

    // B: home_away NEUTRAL (50/50), readiness CONTRADICTS (-12).
    const bHa = surface.find((e) => e.teamId === teamB && e.moduleKey === 'home_away_split')!;
    assert.ok(bHa.items.every((i) => i.contributionDirection === 'NEUTRAL'));
    const bRt = surface.find((e) => e.teamId === teamB && e.moduleKey === 'readiness_tracker')!;
    assert.equal(bRt.items[0].contributionDirection, 'CONTRADICTS');
    assert.equal(bRt.items[0].value, -12, 'negative value preserved');
  });

  it('a zero-valued cited feature value is surfaced as 0, not dropped (team C, momentum 0 → NEUTRAL)', async () => {
    const surface = await withConnection(MODULE_ROLE, (tx) =>
      readCurrentReadingEvidence(tx, { teamIds: [teamC], asOf: CEILING, moduleKeys: ['readiness_tracker'] }));
    const rt = surface.find((e) => e.moduleKey === 'readiness_tracker')!;
    assert.ok(rt, 'team C has a readiness reading');
    assert.equal(rt.items.length, 1);
    assert.equal(rt.items[0].value, 0, 'the zero momentum value survives as 0');
    assert.notEqual(rt.items[0].value, null);
    assert.equal(rt.items[0].contributionDirection, 'NEUTRAL');
  });

  it('an INACTIVE reading produces no evidence (team C home_away_split has no win rates)', async () => {
    const [surface, persistedStatus] = await withConnection(MODULE_ROLE, async (tx) => {
      const s = await readCurrentReadingEvidence(tx, { teamIds: [teamC], asOf: CEILING, moduleKeys: ['home_away_split'], contextCompetitionEditionId: editionId });
      const st = await tx.query<{ status: string }>(
        `SELECT mr.module_status_code status FROM module.module_reading mr JOIN module.module_definition md ON md.id=mr.module_definition_id
          WHERE md.module_key='home_away_split' AND mr.subject_team_id=$1 ORDER BY mr.as_of DESC LIMIT 1`, [teamC]);
      return [s, st.rows[0].status];
    });
    assert.equal(persistedStatus, 'INACTIVE', 'the reading was written INACTIVE');
    assert.equal(surface.length, 0, 'no evidence surfaced for the INACTIVE reading');
  });

  it('evidence tracks the CURRENT reading across as_of (a later reading supersedes)', async () => {
    // A later reading for team A home_away_split, citing DIFFERENT win-rate values.
    await withConnection(FEATURE_ROLE, async (tx) => {
      const reg = await loadRegistry(tx);
      await writeValues(tx, reg, [
        { featureKey: HOME_WIN_RATE, teamId: teamA, asOf: LATER, value: fromInt(90), sampleObservationCount: 9, consumed: [] },
        { featureKey: AWAY_WIN_RATE, teamId: teamA, asOf: LATER, value: fromInt(10), sampleObservationCount: 9, consumed: [] },
      ], LATER, scoped(editionId));
    });
    await withConnection(MODULE_ROLE, (tx) => produceReading(tx, 'home_away_split', homeAwaySplit, teamA, scoped(editionId), LATER));

    const [earlyVals, laterVals] = await withConnection(MODULE_ROLE, async (tx) => [
      (await readCurrentReadingEvidence(tx, { teamIds: [teamA], asOf: AS_OF, moduleKeys: ['home_away_split'], contextCompetitionEditionId: editionId }))
        .find((e) => e.moduleKey === 'home_away_split')!.items.map((i) => i.value).sort((x, y) => x! - y!),
      (await readCurrentReadingEvidence(tx, { teamIds: [teamA], asOf: CEILING, moduleKeys: ['home_away_split'], contextCompetitionEditionId: editionId }))
        .find((e) => e.moduleKey === 'home_away_split')!.items.map((i) => i.value).sort((x, y) => x! - y!),
    ]);
    assert.deepEqual(earlyVals, [20, 80], 'the AS_OF ceiling cites the earlier reading’s values');
    assert.deepEqual(laterVals, [10, 90], 'the later ceiling cites the current (later) reading’s values');
  });
});
