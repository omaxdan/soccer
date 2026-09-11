// ─────────────────────────────────────────────────────────────────────────────
// S-9C — giant_killer_index & consistency_index magnitude output (2.0.0)
//
// PURE tests pin the MEASURED (non-directional) status, the strength values
// (giant_killer = 100·ppgTop/3 round-2, OD-2; consistency = raw volatility, OD-3),
// the emitsMagnitude flag, and the assembly rules: strength is written ONLY at the
// 2.0.0 version (NULL at 1.0.0, D-5a), evidence items carry NEUTRAL for a MEASURED
// finding (the schema CHECK admits no other non-directional value), and an absent
// input is INACTIVE with NULL strength. DB tests prove the end-to-end read →
// assemble → write chain producing MEASURED + strength with confidence and
// published_baseline_id NULL (calibration deferred), plus the version gate.
// ─────────────────────────────────────────────────────────────────────────────

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { loadRegistry } from '../../feature/registry/load';
import { writeValues } from '../../feature/write/values';
import { seedFeatureRegistry } from '../../seed/featureRegistry';
import { seedModuleRegistry } from '../../seed/moduleRegistry';
import { ALL_COMPETITIONS_SCOPE, type CandidateValue } from '../../feature/calculators/types';
import { compare, fromInt, fromString, toNumericString, type Exact } from '../../feature/write/scale';
import { PROVIDER_CODE } from '../../ingestion/provider/config';
import { upsertMutable } from '../../ingestion/write/index';

import { giantKillerIndex } from '../calculators/giantKillerIndex';
import { consistencyIndex } from '../calculators/consistencyIndex';
import { assembleReading, INACTIVE_REASON_FEATURE_ABSENT, MAGNITUDE_VERSION_DESIGNATION, MODULE_CALCULATORS } from '../pipeline';
import { loadModuleRegistry, resolveModuleVersion } from '../registry/load';
import { consumedKey, readConsumedFeatures } from '../read/consumedFeatures';
import { writeReading } from '../write/readings';
import type { ConsumedFeature } from '../types';
import type { ModuleDefinition, ModuleVersion } from '../registry/load';

import { testDatabaseReady } from '../../db/testSupport';
const hasDatabase = testDatabaseReady();
const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
const FEATURE_ROLE = 'pt_pipeline_feature' as const;
const MODULE_ROLE = 'pt_pipeline_module' as const;

const GK_PPG = 'team.giant_killer_ppg';
const GMV = 'team.goal_margin_volatility';
const AS_OF = new Date('2027-05-01T00:00:00Z');

function input(featureKey: string, value: Exact, count = 5, id = 'V'): Map<string, ConsumedFeature> {
  return new Map([[featureKey, { featureKey, valueId: id, asOf: AS_OF, value, sampleObservationCount: count }]]);
}

const V2: ModuleVersion = { moduleVersionId: '200', designation: MAGNITUDE_VERSION_DESIGNATION, minimumSampleObservationCount: 0 };
const V1: ModuleVersion = { moduleVersionId: '100', designation: '1.0.0', minimumSampleObservationCount: 0 };
const GK_DEF = { moduleKey: 'giant_killer_index', moduleDefinitionId: '4', subjectKindCode: 'TEAM', calibrationModeCode: 'OUTCOME_SCORED', outcomeDimensionCode: 'MATCH_RESULT', isActive: true } as unknown as ModuleDefinition;
const CI_DEF = { moduleKey: 'consistency_index', moduleDefinitionId: '3', subjectKindCode: 'TEAM', calibrationModeCode: 'CONTEXTUAL', outcomeDimensionCode: null, isActive: true } as unknown as ModuleDefinition;

// ─── pure: giant_killer_index ────────────────────────────────────────────────

describe('giant_killer_index — pure MEASURED magnitude (100·ppgTop/3)', () => {
  it('declares itself: key, TEAM, ALL_COMPETITIONS, one input, emitsMagnitude', () => {
    assert.equal(giantKillerIndex.moduleKey, 'giant_killer_index');
    assert.equal(giantKillerIndex.subjectKind, 'TEAM');
    assert.equal(giantKillerIndex.contextKind, 'ALL_COMPETITIONS');
    assert.deepEqual([...giantKillerIndex.inputFeatureKeys], [GK_PPG]);
    assert.equal(giantKillerIndex.emitsMagnitude, true);
  });

  it('MEASURED status, strength = 100·ppg/3 (round 2): 3.00 → 100.00', () => {
    const f = giantKillerIndex.evaluate(input(GK_PPG, fromString('3.00')));
    assert.equal(f.status, 'MEASURED');
    assert.ok(f.strength && compare(f.strength, fromInt(100)) === 0, toNumericString(f.strength!));
  });

  it('strength scales linearly and rounds to two decimals: 1.50 → 50.00; 1.79 → 59.67', () => {
    assert.equal(toNumericString(giantKillerIndex.evaluate(input(GK_PPG, fromString('1.50'))).strength!), '50.00');
    // 100·1.79/3 = 59.6666… → 59.67
    assert.equal(toNumericString(giantKillerIndex.evaluate(input(GK_PPG, fromString('1.79'))).strength!), '59.67');
  });

  it('is deterministic and non-directional (never SUPPORTS/CONTRADICTS)', () => {
    const a = giantKillerIndex.evaluate(input(GK_PPG, fromString('2.10')));
    const b = giantKillerIndex.evaluate(input(GK_PPG, fromString('2.10')));
    assert.equal(toNumericString(a.strength!), toNumericString(b.strength!));
    assert.equal(a.status, 'MEASURED');
  });

  it('throws when its declared input is absent (engine guarantees presence)', () => {
    assert.throws(() => giantKillerIndex.evaluate(new Map()), /without team.giant_killer_ppg/);
  });
});

// ─── pure: consistency_index ─────────────────────────────────────────────────

describe('consistency_index — pure MEASURED magnitude (raw volatility)', () => {
  it('declares itself: key, TEAM, ALL_COMPETITIONS, one input, emitsMagnitude', () => {
    assert.equal(consistencyIndex.moduleKey, 'consistency_index');
    assert.equal(consistencyIndex.subjectKind, 'TEAM');
    assert.equal(consistencyIndex.contextKind, 'ALL_COMPETITIONS');
    assert.deepEqual([...consistencyIndex.inputFeatureKeys], [GMV]);
    assert.equal(consistencyIndex.emitsMagnitude, true);
  });

  it('MEASURED status, strength = the raw volatility, UNCHANGED (no transform)', () => {
    const f = consistencyIndex.evaluate(input(GMV, fromString('0.89')));
    assert.equal(f.status, 'MEASURED');
    assert.equal(toNumericString(f.strength!), '0.89');
  });

  it('passes any volatility through verbatim, including 0', () => {
    assert.equal(toNumericString(consistencyIndex.evaluate(input(GMV, fromString('0.00'))).strength!), '0.00');
    assert.equal(toNumericString(consistencyIndex.evaluate(input(GMV, fromString('2.34'))).strength!), '2.34');
  });

  it('throws when its declared input is absent', () => {
    assert.throws(() => consistencyIndex.evaluate(new Map()), /without team.goal_margin_volatility/);
  });
});

// ─── assembly: version gating, evidence direction, INACTIVE ──────────────────

describe('assembly — strength only at 2.0.0; NEUTRAL evidence; INACTIVE on absence', () => {
  function assemble(version: ModuleVersion) {
    return assembleReading({
      calculator: giantKillerIndex,
      definition: GK_DEF,
      version,
      asOf: AS_OF,
      scope: ALL_COMPETITIONS_SCOPE,
      teamId: '900',
      inputs: input(GK_PPG, fromString('1.50'), 4, 'GKV'),
    });
  }

  it('at 2.0.0: MEASURED, strength "50.00", one evidence item with NEUTRAL direction', () => {
    const r = assemble(V2);
    assert.equal(r.statusCode, 'MEASURED');
    assert.equal(r.strength, '50.00');
    assert.equal(r.inactiveReason, null);
    assert.equal(r.sampleObservationCount, 4, 'D-5c-i: MIN(consumed) passes through');
    assert.equal(r.evidenceItems.length, 1);
    assert.equal(r.evidenceItems[0].contributionDirection, 'NEUTRAL', 'MEASURED contributes NEUTRAL (schema CHECK)');
    assert.equal(r.evidenceItems[0].citedFeatureValueId, 'GKV');
  });

  it('at 1.0.0: strength is NULL even though the finding carries one (D-5a freeze)', () => {
    const r = assemble(V1);
    // The engine skips magnitude modules before 2.0.0; assembleReading double-guards
    // strength to NULL at any non-magnitude version.
    assert.equal(r.strength, null);
  });

  it('consistency at 2.0.0: MEASURED, raw strength, NEUTRAL evidence', () => {
    const r = assembleReading({
      calculator: consistencyIndex, definition: CI_DEF, version: V2,
      asOf: AS_OF, scope: ALL_COMPETITIONS_SCOPE, teamId: '900',
      inputs: input(GMV, fromString('1.23'), 6, 'CIV'),
    });
    assert.equal(r.statusCode, 'MEASURED');
    assert.equal(r.strength, '1.23');
    assert.equal(r.evidenceItems[0].contributionDirection, 'NEUTRAL');
  });

  it('absent input → INACTIVE, silent, NULL strength, no evidence', () => {
    const r = assembleReading({
      calculator: giantKillerIndex, definition: GK_DEF, version: V2,
      asOf: AS_OF, scope: ALL_COMPETITIONS_SCOPE, teamId: '900', inputs: new Map(),
    });
    assert.equal(r.statusCode, 'INACTIVE');
    assert.equal(r.strength, null);
    assert.equal(r.inactiveReason, INACTIVE_REASON_FEATURE_ABSENT);
    assert.equal(r.evidenceItems.length, 0);
  });

  it('MODULE_CALCULATORS registers both magnitude modules', () => {
    const keys = MODULE_CALCULATORS.map((c) => c.moduleKey);
    assert.ok(keys.includes('giant_killer_index'));
    assert.ok(keys.includes('consistency_index'));
  });
});

// ─── DB: end-to-end read → assemble → write at 2.0.0 ─────────────────────────

const PFX = 'S9C';

describe('magnitude modules against the DB (2.0.0 read → assemble → write)', { skip: !hasDatabase }, () => {
  const teamIds = new Map<string, string>();

  before(async () => {
    await withConnection(FEATURE_ROLE, (tx) => seedFeatureRegistry(tx));
    // Seed the module registry so the 2.0.0 versions exist and cover AS_OF (2027).
    await withConnection(MODULE_ROLE, (tx) => seedModuleRegistry(tx));
    await withConnection(INGESTION_ROLE, async (tx) => {
      const venue = await upsertMutable(tx, {
        relation: 'football.venue',
        columns: ['provider_external_id', 'name', 'country_code'],
        values: [`${PFX}-V`, 'Magnitude Park', 'GB'],
        conflictTarget: ['provider_external_id'],
      });
      for (const band of ['gk', 'ci', 'absent'] as const) {
        const team = await upsertMutable(tx, {
          relation: 'football.team',
          columns: ['provider_code', 'provider_external_id', 'name', 'slug', 'country_code', 'home_venue_id'],
          values: [PROVIDER_CODE, `${PFX}-T-${band}`, `S9C ${band}`, `${PFX}-t-${band}`.toLowerCase(), 'GB', venue.id],
          conflictTarget: ['provider_code', 'provider_external_id'],
        });
        teamIds.set(band, String(team.id));
      }
    });
    // Commit substrate feature values: giant_killer_ppg for 'gk', volatility for 'ci'.
    await withConnection(FEATURE_ROLE, async (tx) => {
      const registry = await loadRegistry(tx);
      const candidates: CandidateValue[] = [
        { featureKey: GK_PPG, teamId: teamIds.get('gk')!, asOf: AS_OF, value: fromString('1.50'), sampleObservationCount: 4, consumed: [] },
        { featureKey: GMV, teamId: teamIds.get('ci')!, asOf: AS_OF, value: fromString('0.89'), sampleObservationCount: 6, consumed: [] },
      ];
      await writeValues(tx, registry, candidates, AS_OF);
    });
  });
  after(async () => { await closeAllPools(); });

  async function inRolledBackTx<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    return withConnection(MODULE_ROLE, async (tx) => {
      await tx.query('BEGIN');
      try { return await fn(tx); } finally { await tx.query('ROLLBACK'); }
    });
  }

  it('resolves 2.0.0 at AS_OF for a magnitude module', async () => {
    await withConnection(MODULE_ROLE, async (tx) => {
      const reg = await loadModuleRegistry(tx);
      const def = reg.definitionsByKey.get('giant_killer_index')!;
      const version = await resolveModuleVersion(tx, def.moduleDefinitionId, AS_OF);
      assert.ok(version, 'a version covers AS_OF');
      assert.equal(version!.designation, MAGNITUDE_VERSION_DESIGNATION, 'AS_OF resolves to 2.0.0');
    });
  });

  it('giant_killer_index writes MEASURED + strength 50.00, confidence/baseline NULL', async () => {
    await inRolledBackTx(async (tx) => {
      const reg = await loadModuleRegistry(tx);
      const def = reg.definitionsByKey.get('giant_killer_index')!;
      const version = await resolveModuleVersion(tx, def.moduleDefinitionId, AS_OF);
      const teamId = teamIds.get('gk')!;
      const consumed = await readConsumedFeatures(tx, giantKillerIndex.inputFeatureKeys, [teamId], AS_OF, ALL_COMPETITIONS_SCOPE);
      const inputs = new Map<string, ConsumedFeature>();
      for (const k of giantKillerIndex.inputFeatureKeys) {
        const c = consumed.get(consumedKey(k, teamId));
        if (c) inputs.set(k, c);
      }
      const reading = assembleReading({ calculator: giantKillerIndex, definition: def, version: version!, asOf: AS_OF, scope: ALL_COMPETITIONS_SCOPE, teamId, inputs });
      assert.equal(reading.statusCode, 'MEASURED');
      const res = await writeReading(tx, { ...reading, calculatedAt: AS_OF });
      assert.equal(res.written, 1);
      const { rows } = await tx.query(
        `SELECT module_status_code, strength, confidence, published_baseline_id, subject_kind_code
           FROM module.module_reading WHERE as_of = $1 AND subject_team_id = $2`,
        [AS_OF, teamId]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].module_status_code, 'MEASURED');
      assert.equal(Number(rows[0].strength), 50, 'strength = 100·1.50/3 = 50.00');
      assert.equal(rows[0].confidence, null);
      assert.equal(rows[0].published_baseline_id, null);
      assert.equal(rows[0].subject_kind_code, 'TEAM');
    });
  });

  it('consistency_index writes MEASURED + raw volatility strength, confidence/baseline NULL', async () => {
    await inRolledBackTx(async (tx) => {
      const reg = await loadModuleRegistry(tx);
      const def = reg.definitionsByKey.get('consistency_index')!;
      const version = await resolveModuleVersion(tx, def.moduleDefinitionId, AS_OF);
      const teamId = teamIds.get('ci')!;
      const consumed = await readConsumedFeatures(tx, consistencyIndex.inputFeatureKeys, [teamId], AS_OF, ALL_COMPETITIONS_SCOPE);
      const inputs = new Map<string, ConsumedFeature>();
      for (const k of consistencyIndex.inputFeatureKeys) {
        const c = consumed.get(consumedKey(k, teamId));
        if (c) inputs.set(k, c);
      }
      const reading = assembleReading({ calculator: consistencyIndex, definition: def, version: version!, asOf: AS_OF, scope: ALL_COMPETITIONS_SCOPE, teamId, inputs });
      const res = await writeReading(tx, { ...reading, calculatedAt: AS_OF });
      assert.equal(res.written, 1);
      const { rows } = await tx.query(
        `SELECT module_status_code, strength, confidence, published_baseline_id
           FROM module.module_reading WHERE as_of = $1 AND subject_team_id = $2`,
        [AS_OF, teamId]
      );
      assert.equal(rows[0].module_status_code, 'MEASURED');
      assert.equal(Number(rows[0].strength), 0.89);
      assert.equal(rows[0].confidence, null);
      assert.equal(rows[0].published_baseline_id, null);
    });
  });

  it('1.0.0 remains immutable and NULL-frozen: its period is closed and it carries no readings', async () => {
    await withConnection(MODULE_ROLE, async (tx) => {
      const { rows } = await tx.query(
        `SELECT v.designation, upper_inf(v.effective_period) AS open
           FROM module.module_version v
           JOIN module.module_definition d ON d.id = v.module_definition_id
          WHERE d.module_key = 'giant_killer_index'
          ORDER BY v.designation`
      );
      const byDes = new Map(rows.map((r: any) => [r.designation, r.open]));
      assert.equal(byDes.get('1.0.0'), false, '1.0.0 period is closed (successor arrived)');
      assert.equal(byDes.get('2.0.0'), true, '2.0.0 is the open, in-force version');
    });
  });
});
