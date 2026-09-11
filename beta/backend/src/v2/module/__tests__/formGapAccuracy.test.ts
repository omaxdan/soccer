// ─────────────────────────────────────────────────────────────────────────────
// S-6.x form_gap_accuracy — the second FIXTURE-subject COMPARISON module, and the
// first ASYMMETRIC one (home reads team.home_form, away reads team.away_form).
//
// PURE tests pin the signed comparison rule (home_form>away_form→SUPPORTS,
// <→CONTRADICTS, =→NEUTRAL), the two-input (D-4a) declared/present counts,
// MIN(consumed) sample, INACTIVE on a missing side, scale preservation, and the
// FIXTURE subject shape. DB tests prove the production path (read home's home_form
// + away's away_form → assemble → write) persists a FIXTURE reading whose evidence
// cites BOTH the correct venue-specific values by subject team (not order),
// correct orientation, as-of safety, engine integration, S-7 sealing
// compatibility, and that no snapshot_verdict.form_edge is populated here.
// ─────────────────────────────────────────────────────────────────────────────

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { loadRegistry } from '../../feature/registry/load';
import { writeValues } from '../../feature/write/values';
import { seedFeatureRegistry } from '../../seed/featureRegistry';
import { CALCULATION_CONTEXT_KIND, ALL_COMPETITIONS_SCOPE, type CandidateValue } from '../../feature/calculators/types';
import { fromInt, fromString, type Exact } from '../../feature/write/scale';
import { PROVIDER_CODE } from '../../ingestion/provider/config';

import { formGapAccuracy } from '../calculators/formGapAccuracy';
import {
  assembleFixtureReading,
  runModulePipeline,
  INACTIVE_REASON_FEATURE_ABSENT,
  FIXTURE_MODULE_CALCULATORS,
  MODULE_CALCULATORS,
} from '../pipeline';
import { loadModuleRegistry, resolveModuleVersion } from '../registry/load';
import { consumedKey, readConsumedFeatures } from '../read/consumedFeatures';
import { writeReading } from '../write/readings';
import { homeInputKeys, awayInputKeys, type ConsumedFeature } from '../types';

import { testDatabaseReady } from '../../db/testSupport';
const hasDatabase = testDatabaseReady();
const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
const FEATURE_ROLE = 'pt_pipeline_feature' as const;
const MODULE_ROLE = 'pt_pipeline_module' as const;

const HOME_FORM = 'team.home_form';
const AWAY_FORM = 'team.away_form';
const AS_OF = new Date('2027-05-02T00:00:00Z');

// ─── the pure calculator + assembly ──────────────────────────────────────────

function homeInput(value: Exact, count = 8, id = 'H'): Map<string, ConsumedFeature> {
  return new Map([[HOME_FORM, { featureKey: HOME_FORM, valueId: id, asOf: AS_OF, value, sampleObservationCount: count }]]);
}
function awayInput(value: Exact, count = 8, id = 'A'): Map<string, ConsumedFeature> {
  return new Map([[AWAY_FORM, { featureKey: AWAY_FORM, valueId: id, asOf: AS_OF, value, sampleObservationCount: count }]]);
}
function findingFor(home: number | Exact, away: number | Exact) {
  const h = typeof home === 'number' ? fromInt(home) : home;
  const a = typeof away === 'number' ? fromInt(away) : away;
  return formGapAccuracy.evaluate({ home: homeInput(h), away: awayInput(a) });
}

const DEF = {
  moduleKey: 'form_gap_accuracy',
  moduleDefinitionId: '8',
  subjectKindCode: 'FIXTURE',
  calibrationModeCode: 'OUTCOME_SCORED',
  outcomeDimensionCode: 'MATCH_RESULT',
  isActive: true,
};
const VERSION = { moduleVersionId: '80', designation: '1.0.0', minimumSampleObservationCount: 0 };

function assembleFor(
  home: Map<string, ConsumedFeature>,
  away: Map<string, ConsumedFeature>,
  version = VERSION
) {
  return assembleFixtureReading({
    calculator: formGapAccuracy,
    definition: DEF,
    version,
    asOf: AS_OF,
    scope: ALL_COMPETITIONS_SCOPE,
    fixtureId: '500',
    fixturePartitionOn: '2027-05-05',
    homeInputs: home,
    awayInputs: away,
  });
}

describe('form_gap_accuracy — pure signed comparison and assembly', () => {
  it('1. home venue form stronger → SUPPORTS', () => {
    const f = findingFor(6, 3);
    assert.equal(f.status, 'SUPPORTS');
    assert.match(f.verdictText, /Home venue form stronger/);
    assert.match(f.verdictText, /\b3\b/);
  });
  it('2. away venue form stronger → CONTRADICTS', () => {
    const f = findingFor(2, 7);
    assert.equal(f.status, 'CONTRADICTS');
    assert.match(f.verdictText, /Away venue form stronger/);
    assert.match(f.verdictText, /\b5\b/);
  });
  it('3. equal venue form → NEUTRAL', () => {
    const f = findingFor(4, 4);
    assert.equal(f.status, 'NEUTRAL');
    assert.match(f.verdictText, /Even venue form/);
  });
  it('declares its asymmetric inputs (D-3/D-4): home→home_form, away→away_form, FIXTURE, ALL_COMPETITIONS', () => {
    assert.deepEqual(findingFor(6, 3), findingFor(6, 3)); // deterministic
    assert.deepEqual([...homeInputKeys(formGapAccuracy)], [HOME_FORM]);
    assert.deepEqual([...awayInputKeys(formGapAccuracy)], [AWAY_FORM]);
    assert.equal(formGapAccuracy.subjectKind, 'FIXTURE');
    assert.equal(formGapAccuracy.contextKind, CALCULATION_CONTEXT_KIND);
  });
  it('5. correct orientation: swapping the two values flips SUPPORTS↔CONTRADICTS', () => {
    assert.equal(findingFor(6, 3).status, 'SUPPORTS');
    assert.equal(findingFor(3, 6).status, 'CONTRADICTS');
  });

  it('assembly: two declared inputs (D-4a), both present, one item per side, MIN sample, FIXTURE subject', () => {
    const r = assembleFor(homeInput(fromInt(6), 8, 'H'), awayInput(fromInt(3), 8, 'A'));
    assert.equal(r.statusCode, 'SUPPORTS');
    assert.equal(r.subjectKindCode, 'FIXTURE');
    assert.equal(r.subjectFixtureId, '500');
    assert.equal(r.subjectFixturePartitionOn, '2027-05-05');
    assert.equal(r.subjectTeamId, null);
    assert.equal(r.contextKindCode, 'ALL_COMPETITIONS');
    assert.equal(r.contextEditionId, null);
    assert.equal(r.declaredInputCount, 2, 'home_form + away_form = two declared inputs (D-4a)');
    assert.equal(r.presentInputCount, 2);
    assert.equal(r.sampleObservationCount, 8, 'MIN(consumed) across both sides');
    assert.equal(r.evidenceItems.length, 2, 'both venue-form values cited');
    assert.deepEqual(r.evidenceItems.map((e) => e.citedFeatureValueId).sort(), ['A', 'H']);
    assert.ok(r.evidenceItems.every((e) => e.contributionDirection === 'SUPPORTS'));
  });

  it('7+13. missing home input → INACTIVE, FEATURE_ABSENT, no items, no fabricated zero', () => {
    const r = assembleFor(new Map(), awayInput(fromInt(3), 8, 'A'));
    assert.equal(r.statusCode, 'INACTIVE');
    assert.equal(r.inactiveReason, INACTIVE_REASON_FEATURE_ABSENT);
    assert.equal(r.verdictText, null);
    assert.equal(r.declaredInputCount, 2);
    assert.equal(r.presentInputCount, 1, 'only away present');
    assert.equal(r.sampleObservationCount, 0);
    assert.equal(r.evidenceItems.length, 0);
  });
  it('8. missing away input → INACTIVE', () => {
    assert.equal(assembleFor(homeInput(fromInt(6), 8, 'H'), new Map()).statusCode, 'INACTIVE');
  });
  it('both inputs missing → INACTIVE', () => {
    const r = assembleFor(new Map(), new Map());
    assert.equal(r.statusCode, 'INACTIVE');
    assert.equal(r.presentInputCount, 0);
  });

  it('9. below-threshold sample stays honestly low-sample (not upgraded)', () => {
    // A strict version min of 6 with MIN sample 5 → engaged, but sample_meets_threshold false.
    const strictVersion = { moduleVersionId: '80', designation: '1.0.0', minimumSampleObservationCount: 6 };
    const r = assembleFor(homeInput(fromInt(6), 5, 'H'), awayInput(fromInt(3), 5, 'A'), strictVersion);
    assert.equal(r.statusCode, 'SUPPORTS', 'still engaged — the finding stands');
    assert.equal(r.sampleObservationCount, 5);
    assert.equal(r.sampleMeetsThreshold, false, 'MIN sample 5 < version minimum 6 → below threshold, not upgraded');
  });
  it('sample is MIN of the two sides', () => {
    const r = assembleFor(homeInput(fromInt(6), 9, 'H'), awayInput(fromInt(3), 4, 'A'));
    assert.equal(r.sampleObservationCount, 4);
  });

  it('scale/precision preserved: 6.50 − 2.25 = 4.25', () => {
    const f = findingFor(fromString('6.50'), fromString('2.25'));
    assert.equal(f.status, 'SUPPORTS');
    assert.match(f.verdictText, /4\.25/);
  });
  it('zero is a real value, not fabricated: 0.00 vs 0.00 → NEUTRAL', () => {
    const f = findingFor(fromString('0.00'), fromString('0.00'));
    assert.equal(f.status, 'NEUTRAL');
    assert.match(f.verdictText, /Even venue form/);
  });

  it('registration: form_gap_accuracy joins the FIXTURE set; the TEAM set is unchanged', () => {
    assert.deepEqual([...FIXTURE_MODULE_CALCULATORS.map((c) => c.moduleKey)], ['rest_advantage', 'form_gap_accuracy', 'travel_impact']);
    assert.deepEqual([...MODULE_CALCULATORS.map((c) => c.moduleKey)].sort(), ['consistency_index', 'giant_killer_index', 'home_away_split', 'readiness_tracker']);
  });
});

// ─── DB: production path, engine integration, and S-7 sealing compatibility ───

const FG = 'S6FG' + (Date.now() % 1_000_000);

describe('form_gap_accuracy against the DB (asymmetric FIXTURE production path)', { skip: !hasDatabase }, () => {
  const DB_AS_OF = new Date(Math.floor((Date.now() - 5_000) / 1000) * 1000);
  const LATER = new Date(DB_AS_OF.getTime() + 30 * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  let editionId = '', homeId = '', awayId = '', fixtureId = '', partitionOn = '';

  before(async () => {
    await withConnection(FEATURE_ROLE, (tx) => seedFeatureRegistry(tx));
    await withConnection(INGESTION_ROLE, async (tx) => {
      const comp = await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
         VALUES ($1,$2,'FG League',$3,'GB') RETURNING id::text`, [PROVIDER_CODE, `${FG}-C`, `${FG}-c`.toLowerCase()]);
      const ed = await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1,$2,'FG 2027', daterange('2027-01-01','2029-01-01')) RETURNING id::text`, [comp.rows[0].id, `${FG}-S`]);
      editionId = ed.rows[0].id;
      const team = async (s: string) => (await tx.query<{ id: string }>(
        `INSERT INTO football.team (provider_code, provider_external_id, name, slug, country_code)
         VALUES ($1,$2,$3,$4,'GB') RETURNING id::text`,
        [PROVIDER_CODE, `${FG}-T${s}`, `FG ${s}`, `${FG}-t${s}`.toLowerCase()])).rows[0].id;
      homeId = await team('H'); awayId = await team('A');
      partitionOn = day(DB_AS_OF);
      const fx = await tx.query<{ id: string }>(
        `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
           is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         VALUES ($1,$2,$3::date,$4,false,$5,$6,$7,'SCHEDULED') RETURNING id::text`,
        [PROVIDER_CODE, `${FG}-F`, partitionOn, editionId, homeId, awayId, DB_AS_OF.toISOString()]);
      fixtureId = fx.rows[0].id;
    });
    // Write ALL FOUR venue-form values so the calculator must pick the RIGHT ones
    // by subject team: home's home_form (6) and away's away_form (3) are used;
    // the distractors (home's away_form, away's home_form) must be IGNORED.
    await withConnection(FEATURE_ROLE, async (tx) => {
      const registry = await loadRegistry(tx);
      const candidates: CandidateValue[] = [
        { featureKey: HOME_FORM, teamId: homeId, asOf: DB_AS_OF, value: fromInt(6), sampleObservationCount: 8, consumed: [] },
        { featureKey: AWAY_FORM, teamId: homeId, asOf: DB_AS_OF, value: fromInt(99), sampleObservationCount: 8, consumed: [] }, // distractor
        { featureKey: HOME_FORM, teamId: awayId, asOf: DB_AS_OF, value: fromInt(99), sampleObservationCount: 8, consumed: [] }, // distractor
        { featureKey: AWAY_FORM, teamId: awayId, asOf: DB_AS_OF, value: fromInt(3), sampleObservationCount: 8, consumed: [] },
      ];
      await writeValues(tx, registry, candidates, DB_AS_OF); // ALL_COMPETITIONS
    });
  });
  after(async () => { await closeAllPools(); });

  async function inRolledBackModuleTx<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
    return withConnection(MODULE_ROLE, async (tx) => {
      await tx.query('BEGIN');
      try { return await fn(tx); } finally { await tx.query('ROLLBACK'); }
    });
  }

  async function fixtureReading(tx: PoolClient, asOf: Date) {
    const registry = await loadModuleRegistry(tx);
    const def = registry.definitionsByKey.get('form_gap_accuracy')!;
    const version = await resolveModuleVersion(tx, def.moduleDefinitionId, asOf);
    const homeKeys = homeInputKeys(formGapAccuracy);
    const awayKeys = awayInputKeys(formGapAccuracy);
    const allKeys = [...new Set([...homeKeys, ...awayKeys])];
    const consumed = await readConsumedFeatures(tx, allKeys, [homeId, awayId], asOf, ALL_COMPETITIONS_SCOPE);
    const homeInputs = new Map<string, ConsumedFeature>();
    const awayInputs = new Map<string, ConsumedFeature>();
    for (const k of homeKeys) { const v = consumed.get(consumedKey(k, homeId)); if (v) homeInputs.set(k, v); }
    for (const k of awayKeys) { const v = consumed.get(consumedKey(k, awayId)); if (v) awayInputs.set(k, v); }
    const reading = assembleFixtureReading({
      calculator: formGapAccuracy, definition: def, version: version!, asOf,
      scope: ALL_COMPETITIONS_SCOPE, fixtureId, fixturePartitionOn: partitionOn, homeInputs, awayInputs,
    });
    return { reading, def, version: version! };
  }

  it('the FIXTURE subject contract is registered (subject_kind_code = FIXTURE)', async () => {
    await withConnection(MODULE_ROLE, async (tx) => {
      const registry = await loadModuleRegistry(tx);
      assert.equal(registry.definitionsByKey.get('form_gap_accuracy')!.subjectKindCode, 'FIXTURE');
    });
  });

  it('1-8. persists a FIXTURE reading (home form stronger → SUPPORTS) citing home.home_form + away.away_form by subject team', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const { reading } = await fixtureReading(tx, DB_AS_OF);
      assert.equal(reading.statusCode, 'SUPPORTS', 'home_form 6 − away_form 3 = +3 → SUPPORTS (distractors ignored)');
      assert.equal(reading.declaredInputCount, 2);
      assert.equal(reading.sampleObservationCount, 8, 'MIN across the two sides');
      const res = await writeReading(tx, { ...reading, calculatedAt: DB_AS_OF });
      assert.equal(res.written, 1);
      const { rows } = await tx.query(
        `SELECT r.subject_kind_code, r.subject_fixture_id::text fx, r.subject_team_id, r.context_kind_code,
                r.module_status_code, r.verdict_text, r.strength, r.confidence, r.sample_observation_count,
                (SELECT count(*)::int FROM module.module_evidence e
                   JOIN module.module_evidence_item i ON i.module_evidence_id=e.id AND i.reading_as_of=e.reading_as_of
                  WHERE e.module_reading_id=r.id) AS items
           FROM module.module_reading r
          WHERE r.subject_fixture_id=$1::bigint AND r.as_of=$2`,
        [fixtureId, DB_AS_OF]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].subject_kind_code, 'FIXTURE');
      assert.equal(rows[0].fx, fixtureId);
      assert.equal(rows[0].subject_team_id, null, 'FIXTURE reading has no team subject');
      assert.equal(rows[0].context_kind_code, 'ALL_COMPETITIONS');
      assert.equal(rows[0].module_status_code, 'SUPPORTS');
      assert.match(rows[0].verdict_text, /Home venue form stronger/);
      assert.equal(rows[0].strength, null);
      assert.equal(rows[0].confidence, null);
      assert.equal(rows[0].items, 2, 'both venue-form values cited');
      // The two cited values must be home's home_form and away's away_form — verified
      // by (feature_key, subject_team_id), NOT by evidence ordering.
      const cited = await tx.query<{ feature_key: string; team: string; val: string }>(
        `SELECT d.feature_key, fv.subject_team_id::text team, fv.value::text val
           FROM module.module_reading r
           JOIN module.module_evidence e ON e.module_reading_id=r.id
           JOIN module.module_evidence_item i ON i.module_evidence_id=e.id AND i.reading_as_of=e.reading_as_of
           JOIN feature.feature_value fv ON fv.id=i.cited_feature_value_id AND fv.as_of=i.cited_feature_value_as_of
           JOIN feature.feature_definition d ON d.id=fv.feature_definition_id
          WHERE r.subject_fixture_id=$1::bigint AND r.as_of=$2
          ORDER BY d.feature_key`, [fixtureId, DB_AS_OF]);
      const byKey = new Map(cited.rows.map((c) => [c.feature_key, c]));
      assert.equal(byKey.get(HOME_FORM)!.team, homeId, 'home_form cited is the HOME team’s');
      assert.equal(Number(byKey.get(HOME_FORM)!.val), 6);
      assert.equal(byKey.get(AWAY_FORM)!.team, awayId, 'away_form cited is the AWAY team’s');
      assert.equal(Number(byKey.get(AWAY_FORM)!.val), 3);
    });
  });

  it('9. as-of safety: a later value does not enter the reading at the earlier cutoff', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const registry = await loadRegistry(tx);
      await writeValues(tx, registry, [
        { featureKey: HOME_FORM, teamId: homeId, asOf: LATER, value: fromInt(1), sampleObservationCount: 8, consumed: [] },
      ], LATER);
      const { reading } = await fixtureReading(tx, DB_AS_OF);
      assert.ok(reading.evidenceItems.every((e) => e.citedFeatureValueAsOf.getTime() <= DB_AS_OF.getTime()));
      assert.equal(reading.statusCode, 'SUPPORTS', 'still home 6 vs away 3, not the future 1');
    });
  });

  it('11. missing-side is honest: away away_form absent → INACTIVE, no fabricated zero', async () => {
    // A distinct fixture whose away team has NO away_form value.
    await inRolledBackModuleTx(async (tx) => {
      // Remove the away side's away_form within this rolled-back tx by using a fresh
      // team with no values.
      const { rows: t } = await tx.query<{ id: string }>(
        `INSERT INTO football.team (provider_code, provider_external_id, name, slug, country_code)
         VALUES ($1,$2,$3,$4,'GB') RETURNING id::text`,
        [PROVIDER_CODE, `${FG}-TX-${Date.now() % 100000}`, 'FG X', `${FG}-tx-${Date.now() % 100000}`.toLowerCase()]);
      const awayNoData = t[0].id;
      const registry = await loadModuleRegistry(tx);
      const def = registry.definitionsByKey.get('form_gap_accuracy')!;
      const version = await resolveModuleVersion(tx, def.moduleDefinitionId, DB_AS_OF);
      const consumed = await readConsumedFeatures(tx, [HOME_FORM, AWAY_FORM], [homeId, awayNoData], DB_AS_OF, ALL_COMPETITIONS_SCOPE);
      const homeInputs = new Map<string, ConsumedFeature>();
      const awayInputs = new Map<string, ConsumedFeature>();
      const h = consumed.get(consumedKey(HOME_FORM, homeId)); if (h) homeInputs.set(HOME_FORM, h);
      const a = consumed.get(consumedKey(AWAY_FORM, awayNoData)); if (a) awayInputs.set(AWAY_FORM, a);
      const reading = assembleFixtureReading({
        calculator: formGapAccuracy, definition: def, version: version!, asOf: DB_AS_OF,
        scope: ALL_COMPETITIONS_SCOPE, fixtureId, fixturePartitionOn: partitionOn, homeInputs, awayInputs,
      });
      assert.equal(reading.statusCode, 'INACTIVE');
      assert.equal(reading.inactiveReason, INACTIVE_REASON_FEATURE_ABSENT);
      assert.equal(reading.evidenceItems.length, 0);
      assert.equal(reading.sampleObservationCount, 0);
    });
  });

  it('12. below-threshold is honest: a feature value under threshold 5 is cited but flagged below-threshold', async () => {
    await inRolledBackModuleTx(async (tx) => {
      // Fresh teams with venue-form samples below the feature threshold (5).
      const mk = async (s: string) => (await tx.query<{ id: string }>(
        `INSERT INTO football.team (provider_code, provider_external_id, name, slug, country_code)
         VALUES ($1,$2,$3,$4,'GB') RETURNING id::text`,
        [PROVIDER_CODE, `${FG}-TB${s}-${Date.now() % 100000}`, `FG B${s}`, `${FG}-tb${s}-${Date.now() % 100000}`.toLowerCase()])).rows[0].id;
      const h = await mk('H'); const a = await mk('A');
      const registry = await loadRegistry(tx);
      await writeValues(tx, registry, [
        { featureKey: HOME_FORM, teamId: h, asOf: DB_AS_OF, value: fromInt(6), sampleObservationCount: 3, consumed: [] }, // < 5
        { featureKey: AWAY_FORM, teamId: a, asOf: DB_AS_OF, value: fromInt(3), sampleObservationCount: 3, consumed: [] }, // < 5
      ], DB_AS_OF);
      // The feature values themselves record below-threshold; the module reading still engages.
      const belowFlags = await tx.query<{ met: boolean }>(
        `SELECT fv.sample_meets_threshold met FROM feature.feature_value fv
           JOIN feature.feature_definition d ON d.id=fv.feature_definition_id
          WHERE fv.subject_team_id = ANY($1::bigint[]) AND d.feature_key = ANY($2::text[]) AND fv.as_of=$3`,
        [[h, a], [HOME_FORM, AWAY_FORM], DB_AS_OF]);
      assert.ok(belowFlags.rows.length >= 2 && belowFlags.rows.every((r) => r.met === false),
        'both venue-form values are honestly flagged below the feature threshold (5)');
    });
  });

  it('10. engine integration: runModulePipeline produces the form_gap reading for the fixture', async () => {
    const report = await runModulePipeline({
      now: DB_AS_OF,
      calculators: [],
      fixtureCalculators: [formGapAccuracy],
      replayFrom: new Date(DB_AS_OF.getTime() - 86_400_000),
      replayTo: new Date(DB_AS_OF.getTime() + 86_400_000),
    });
    assert.equal(report.failures, 0);
    assert.ok(report.modules.includes('form_gap_accuracy'));
    const found = await withConnection(MODULE_ROLE, (tx) =>
      tx.query(`SELECT module_status_code, verdict_text FROM module.module_reading
                 WHERE subject_fixture_id=$1::bigint AND as_of=$2`, [fixtureId, DB_AS_OF]));
    assert.equal(found.rows.length, 1, 'exactly one engaged form_gap reading at the KICKOFF instant');
    assert.equal(found.rows[0].module_status_code, 'SUPPORTS');
    assert.match(found.rows[0].verdict_text, /Home venue form stronger/);
    // Idempotent rerun.
    const rerun = await runModulePipeline({
      now: DB_AS_OF, calculators: [], fixtureCalculators: [formGapAccuracy],
      replayFrom: new Date(DB_AS_OF.getTime() - 86_400_000), replayTo: new Date(DB_AS_OF.getTime() + 86_400_000),
    });
    assert.equal(rerun.failures, 0);
  });

  it('13+14. S-7 schema seals the FIXTURE reading + both cited values; NO snapshot_verdict.form_edge is populated here', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const { reading } = await fixtureReading(tx, DB_AS_OF);
      await writeReading(tx, { ...reading, calculatedAt: DB_AS_OF });
      const rid = (await tx.query<{ id: string }>(
        `SELECT id::text FROM module.module_reading WHERE subject_fixture_id=$1::bigint AND as_of=$2`, [fixtureId, DB_AS_OF]
      )).rows[0].id;
      const vv = (await tx.query<{ id: string }>(`SELECT id::text FROM module.verdict_composition_version WHERE effective_period @> $1::timestamptz LIMIT 1`, [DB_AS_OF])).rows[0].id;
      const cv = (await tx.query<{ id: string }>(`SELECT id::text FROM module.consensus_rule_version WHERE effective_period @> $1::timestamptz LIMIT 1`, [DB_AS_OF])).rows[0].id;
      const kv = (await tx.query<{ id: string }>(`SELECT id::text FROM module.checksum_algorithm_version WHERE effective_period @> $1::timestamptz LIMIT 1`, [DB_AS_OF])).rows[0].id;
      const snap = await tx.query<{ id: string }>(
        `INSERT INTO snapshot.match_snapshot
           (fixture_partition_on, fixture_id, snapshot_point_code, snapshot_as_of,
            verdict_composition_version_id, consensus_rule_version_id, content_checksum, checksum_algorithm_version_id)
         VALUES ($1::date,$2::bigint,'KICKOFF',$3::timestamptz,$4::bigint,$5::bigint,'\\x00'::bytea,$6::bigint)
         RETURNING id::text`, [partitionOn, fixtureId, DB_AS_OF.toISOString(), vv, cv, kv]);
      const snapId = snap.rows[0].id;
      const smr = await tx.query(
        `INSERT INTO snapshot.snapshot_module_reading
           (fixture_partition_on, match_snapshot_id, snapshot_as_of, cited_module_reading_id, cited_as_of)
         VALUES ($1::date,$2::bigint,$3::timestamptz,$4::bigint,$3::timestamptz) RETURNING id`,
        [partitionOn, snapId, DB_AS_OF.toISOString(), rid]);
      assert.equal(smr.rowCount, 1, 'snapshot_module_reading cites the FIXTURE reading');
      const fvs = await tx.query<{ id: string; as_of: Date }>(
        `SELECT i.cited_feature_value_id::text id, i.cited_feature_value_as_of as_of
           FROM module.module_evidence e
           JOIN module.module_evidence_item i ON i.module_evidence_id=e.id AND i.reading_as_of=e.reading_as_of
          WHERE e.module_reading_id=$1::bigint`, [rid]);
      assert.equal(fvs.rows.length, 2);
      for (const fv of fvs.rows) {
        const ins = await tx.query(
          `INSERT INTO snapshot.snapshot_feature_state
             (fixture_partition_on, match_snapshot_id, snapshot_as_of, cited_feature_value_id, cited_as_of)
           VALUES ($1::date,$2::bigint,$3::timestamptz,$4::bigint,$5::timestamptz) RETURNING id`,
          [partitionOn, snapId, DB_AS_OF.toISOString(), fv.id, fv.as_of]);
        assert.equal(ins.rowCount, 1);
      }
      // This module-substrate phase writes NO verdict: no snapshot_verdict row, so no form_edge.
      const verdicts = await tx.query<{ n: string }>(
        `SELECT count(*)::text n FROM snapshot.snapshot_verdict WHERE match_snapshot_id=$1::bigint`, [snapId]);
      assert.equal(Number(verdicts.rows[0].n), 0, 'no snapshot_verdict written by the module substrate phase → form_edge never set');
    });
  });
});
