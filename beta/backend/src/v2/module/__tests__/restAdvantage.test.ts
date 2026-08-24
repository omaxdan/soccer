// ─────────────────────────────────────────────────────────────────────────────
// S-6.x rest_advantage — the first FIXTURE-subject COMPARISON module
//
// PURE tests pin the signed comparison rule (H>A→SUPPORTS "Home fresher",
// A>H→CONTRADICTS "Away fresher", H=A→NEUTRAL "Even rest"), the two-input (D-4a)
// declared/present counts, MIN(consumed) sample, INACTIVE on a missing side, and
// the FIXTURE subject shape. DB tests prove the production path (read both teams'
// team.rest_advantage → assemble → write) persists a FIXTURE reading with evidence
// citing BOTH sides, correct orientation, as-of safety, engine integration, and
// that the sealed schema accepts the reading (S-7 compatibility).
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
import { fromInt, type Exact } from '../../feature/write/scale';
import { PROVIDER_CODE } from '../../ingestion/provider/config';

import { restAdvantage } from '../calculators/restAdvantage';
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
import type { ConsumedFeature } from '../types';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);
const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
const FEATURE_ROLE = 'pt_pipeline_feature' as const;
const MODULE_ROLE = 'pt_pipeline_module' as const;

const REST = 'team.rest_advantage';
const AS_OF = new Date('2027-05-02T00:00:00Z');

// ─── the pure calculator + assembly ──────────────────────────────────────────

function restInput(days: number, count = 1, id = 'R'): Map<string, ConsumedFeature> {
  return new Map([[REST, { featureKey: REST, valueId: id, asOf: AS_OF, value: fromInt(days), sampleObservationCount: count }]]);
}
function findingFor(homeDays: number, awayDays: number) {
  return restAdvantage.evaluate({ home: restInput(homeDays), away: restInput(awayDays) });
}

const DEF = {
  moduleKey: 'rest_advantage',
  moduleDefinitionId: '6',
  subjectKindCode: 'FIXTURE',
  calibrationModeCode: 'OUTCOME_SCORED',
  outcomeDimensionCode: 'MATCH_RESULT',
  isActive: true,
};
const VERSION = { moduleVersionId: '60', designation: '1.0.0', minimumSampleObservationCount: 0 };

function assembleFor(
  home: Map<string, ConsumedFeature>,
  away: Map<string, ConsumedFeature>,
  version = VERSION
) {
  return assembleFixtureReading({
    calculator: restAdvantage,
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

describe('rest_advantage — pure signed comparison and assembly', () => {
  it('1. home has more rest → SUPPORTS ("Home fresher")', () => {
    const f = findingFor(6, 3);
    assert.equal(f.status, 'SUPPORTS');
    assert.match(f.verdictText, /Home fresher/);
    assert.match(f.verdictText, /3 days/);
  });
  it('2. away has more rest → CONTRADICTS ("Away fresher")', () => {
    const f = findingFor(2, 7);
    assert.equal(f.status, 'CONTRADICTS');
    assert.match(f.verdictText, /Away fresher/);
    assert.match(f.verdictText, /5 days/);
  });
  it('3. equal rest → NEUTRAL ("Even rest")', () => {
    const f = findingFor(4, 4);
    assert.equal(f.status, 'NEUTRAL');
    assert.match(f.verdictText, /Even rest/);
  });
  it('is deterministic and declares its input (D-3/D-4): team.rest_advantage, FIXTURE, ALL_COMPETITIONS', () => {
    assert.deepEqual(findingFor(6, 3), findingFor(6, 3));
    assert.deepEqual([...restAdvantage.inputFeatureKeys], [REST]);
    assert.equal(restAdvantage.subjectKind, 'FIXTURE');
    assert.equal(restAdvantage.contextKind, CALCULATION_CONTEXT_KIND);
  });

  it('9. correct orientation: swapping the sides flips SUPPORTS↔CONTRADICTS', () => {
    assert.equal(findingFor(6, 3).status, 'SUPPORTS');
    assert.equal(findingFor(3, 6).status, 'CONTRADICTS');
  });

  it('assembly: two declared inputs (D-4a), both present, one item per side, MIN sample, FIXTURE subject', () => {
    const r = assembleFor(restInput(6, 1, 'H'), restInput(3, 1, 'A'));
    assert.equal(r.statusCode, 'SUPPORTS');
    assert.equal(r.subjectKindCode, 'FIXTURE');
    assert.equal(r.subjectFixtureId, '500');
    assert.equal(r.subjectFixturePartitionOn, '2027-05-05');
    assert.equal(r.subjectTeamId, null);
    assert.equal(r.contextKindCode, 'ALL_COMPETITIONS');
    assert.equal(r.contextEditionId, null);
    assert.equal(r.declaredInputCount, 2, 'per-side input counts as two (D-4a)');
    assert.equal(r.presentInputCount, 2);
    assert.equal(r.sampleObservationCount, 1, 'MIN(consumed) across both sides');
    assert.equal(r.evidenceItems.length, 2, 'both sides’ rest values cited');
    assert.deepEqual(r.evidenceItems.map((e) => e.citedFeatureValueId).sort(), ['A', 'H']);
    assert.ok(r.evidenceItems.every((e) => e.contributionDirection === 'SUPPORTS'));
  });

  it('4+11. missing home input → INACTIVE, FEATURE_ABSENT, no items, no fabricated zero', () => {
    const r = assembleFor(new Map(), restInput(3, 1, 'A'));
    assert.equal(r.statusCode, 'INACTIVE');
    assert.equal(r.inactiveReason, INACTIVE_REASON_FEATURE_ABSENT);
    assert.equal(r.verdictText, null);
    assert.equal(r.declaredInputCount, 2);
    assert.equal(r.presentInputCount, 1, 'only away present');
    assert.equal(r.sampleObservationCount, 0);
    assert.equal(r.evidenceItems.length, 0);
  });
  it('5. missing away input → INACTIVE', () => {
    assert.equal(assembleFor(restInput(6, 1, 'H'), new Map()).statusCode, 'INACTIVE');
  });
  it('6. both inputs missing → INACTIVE', () => {
    const r = assembleFor(new Map(), new Map());
    assert.equal(r.statusCode, 'INACTIVE');
    assert.equal(r.presentInputCount, 0);
  });

  it('7. below-threshold sample stays honestly low-sample (not upgraded)', () => {
    const strictVersion = { moduleVersionId: '60', designation: '1.0.0', minimumSampleObservationCount: 2 };
    const r = assembleFor(restInput(6, 1, 'H'), restInput(3, 1, 'A'), strictVersion);
    assert.equal(r.statusCode, 'SUPPORTS', 'still engaged — the finding stands');
    assert.equal(r.sampleObservationCount, 1);
    assert.equal(r.sampleMeetsThreshold, false, 'MIN sample 1 < version minimum 2 → below threshold, not upgraded');
  });
  it('13. sample is MIN of the two sides', () => {
    const r = assembleFor(restInput(6, 5, 'H'), restInput(3, 2, 'A'));
    assert.equal(r.sampleObservationCount, 2);
  });

  it('registration: rest is a FIXTURE calculator; the TEAM set is unchanged', () => {
    assert.deepEqual([...FIXTURE_MODULE_CALCULATORS.map((c) => c.moduleKey)], ['rest_advantage']);
    assert.deepEqual([...MODULE_CALCULATORS.map((c) => c.moduleKey)].sort(), ['home_away_split', 'readiness_tracker']);
  });
});

// ─── DB: production path, engine integration, and S-7 sealing compatibility ───

// Run-unique so the committed fixture/edition/team rows (and the engine-integration
// reading) never collide with a prior run on a reused database.
const RA = 'S6RA' + (Date.now() % 1_000_000);

describe('rest_advantage against the DB (FIXTURE-subject production path)', { skip: !hasDatabase }, () => {
  // Instant in the sealable window [seed time, now]: after seed so the version is
  // in force, and ≤ now so a snapshot citing it satisfies sealed_at >= snapshot_as_of.
  const DB_AS_OF = new Date(Math.floor((Date.now() - 5_000) / 1000) * 1000);
  const LATER = new Date(DB_AS_OF.getTime() + 30 * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  let editionId = '', homeId = '', awayId = '', fixtureId = '', partitionOn = '';

  before(async () => {
    await withConnection(FEATURE_ROLE, (tx) => seedFeatureRegistry(tx));
    await withConnection(INGESTION_ROLE, async (tx) => {
      // Direct INSERTs (not upsertMutable): football.fixture is partitioned, and
      // ON CONFLICT … RETURNING on a partitioned table raises "cannot retrieve a
      // system column". Plain inserts with a run-unique TAG avoid both issues.
      const comp = await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
         VALUES ($1,$2,'RA League',$3,'GB') RETURNING id::text`, [PROVIDER_CODE, `${RA}-C`, `${RA}-c`.toLowerCase()]);
      const ed = await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1,$2,'RA 2027', daterange('2027-01-01','2029-01-01')) RETURNING id::text`, [comp.rows[0].id, `${RA}-S`]);
      editionId = ed.rows[0].id;
      const team = async (s: string) => (await tx.query<{ id: string }>(
        `INSERT INTO football.team (provider_code, provider_external_id, name, slug, country_code)
         VALUES ($1,$2,$3,$4,'GB') RETURNING id::text`,
        [PROVIDER_CODE, `${RA}-T${s}`, `RA ${s}`, `${RA}-t${s}`.toLowerCase()])).rows[0].id;
      homeId = await team('H'); awayId = await team('A');
      partitionOn = day(DB_AS_OF);
      const fx = await tx.query<{ id: string }>(
        `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
           is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         VALUES ($1,$2,$3::date,$4,false,$5,$6,$7,'SCHEDULED') RETURNING id::text`,
        [PROVIDER_CODE, `${RA}-F`, partitionOn, editionId, homeId, awayId, DB_AS_OF.toISOString()]);
      fixtureId = fx.rows[0].id;
    });
    // Both teams' team.rest_advantage at DB_AS_OF (home fresher: 6 vs 3).
    await withConnection(FEATURE_ROLE, async (tx) => {
      const registry = await loadRegistry(tx);
      const candidates: CandidateValue[] = [
        { featureKey: REST, teamId: homeId, asOf: DB_AS_OF, value: fromInt(6), sampleObservationCount: 1, consumed: [] },
        { featureKey: REST, teamId: awayId, asOf: DB_AS_OF, value: fromInt(3), sampleObservationCount: 1, consumed: [] },
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
    const def = registry.definitionsByKey.get('rest_advantage')!;
    const version = await resolveModuleVersion(tx, def.moduleDefinitionId, asOf);
    const consumed = await readConsumedFeatures(tx, restAdvantage.inputFeatureKeys, [homeId, awayId], asOf, ALL_COMPETITIONS_SCOPE);
    const homeInputs = new Map<string, ConsumedFeature>();
    const awayInputs = new Map<string, ConsumedFeature>();
    for (const k of restAdvantage.inputFeatureKeys) {
      const h = consumed.get(consumedKey(k, homeId)); const a = consumed.get(consumedKey(k, awayId));
      if (h) homeInputs.set(k, h); if (a) awayInputs.set(k, a);
    }
    const reading = assembleFixtureReading({
      calculator: restAdvantage, definition: def, version: version!, asOf,
      scope: ALL_COMPETITIONS_SCOPE, fixtureId, fixturePartitionOn: partitionOn, homeInputs, awayInputs,
    });
    return { reading, def, version: version! };
  }

  it('the FIXTURE subject contract is registered (subject_kind_code = FIXTURE)', async () => {
    await withConnection(MODULE_ROLE, async (tx) => {
      const registry = await loadModuleRegistry(tx);
      assert.equal(registry.definitionsByKey.get('rest_advantage')!.subjectKindCode, 'FIXTURE');
    });
  });

  it('persists a FIXTURE reading (home fresher → SUPPORTS) citing BOTH teams’ rest values', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const { reading } = await fixtureReading(tx, DB_AS_OF);
      assert.equal(reading.statusCode, 'SUPPORTS');
      const res = await writeReading(tx, { ...reading, calculatedAt: DB_AS_OF });
      assert.equal(res.written, 1);
      const { rows } = await tx.query(
        `SELECT r.subject_kind_code, r.subject_fixture_id::text fx, r.subject_fixture_partition_on::text part,
                r.subject_team_id, r.context_kind_code, r.context_competition_edition_id ed,
                r.module_status_code, r.verdict_text, r.strength, r.confidence, r.sample_observation_count,
                (SELECT count(*)::int FROM module.module_evidence e
                   JOIN module.module_evidence_item i ON i.module_evidence_id=e.id AND i.reading_as_of=e.reading_as_of
                  WHERE e.module_reading_id=r.id) AS items,
                (SELECT count(DISTINCT fv.subject_team_id)::int FROM module.module_evidence e
                   JOIN module.module_evidence_item i ON i.module_evidence_id=e.id AND i.reading_as_of=e.reading_as_of
                   JOIN feature.feature_value fv ON fv.id=i.cited_feature_value_id AND fv.as_of=i.cited_feature_value_as_of
                  WHERE e.module_reading_id=r.id) AS distinct_teams_cited
           FROM module.module_reading r
          WHERE r.subject_fixture_id=$1::bigint AND r.as_of=$2`,
        [fixtureId, DB_AS_OF]
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].subject_kind_code, 'FIXTURE');
      assert.equal(rows[0].fx, fixtureId);
      assert.equal(rows[0].part, partitionOn);
      assert.equal(rows[0].subject_team_id, null, 'FIXTURE reading has no team subject');
      assert.equal(rows[0].context_kind_code, 'ALL_COMPETITIONS');
      assert.equal(rows[0].ed, null);
      assert.equal(rows[0].module_status_code, 'SUPPORTS');
      assert.match(rows[0].verdict_text, /Home fresher/);
      assert.equal(rows[0].strength, null);
      assert.equal(rows[0].confidence, null);
      assert.equal(rows[0].sample_observation_count, 1);
      assert.equal(rows[0].items, 2, 'both sides cited');
      assert.equal(rows[0].distinct_teams_cited, 2, 'evidence cites home AND away');
    });
  });

  it('as-of safety: a later rest value does not enter the reading at the earlier cutoff', async () => {
    // Write a LATER home rest value; the reading AT DB_AS_OF must still cite the earlier one.
    await inRolledBackModuleTx(async (tx) => {
      const registry = await loadRegistry(tx);
      await writeValues(tx, registry, [
        { featureKey: REST, teamId: homeId, asOf: LATER, value: fromInt(99), sampleObservationCount: 1, consumed: [] },
      ], LATER);
      const { reading } = await fixtureReading(tx, DB_AS_OF);
      // The cited home value's as_of must be <= the cutoff (never the LATER one).
      assert.ok(reading.evidenceItems.every((e) => e.citedFeatureValueAsOf.getTime() <= DB_AS_OF.getTime()));
      assert.equal(reading.statusCode, 'SUPPORTS', 'still home 6 vs away 3, not the future 99');
    });
  });

  it('engine integration: runModulePipeline produces the rest reading for the fixture', async () => {
    // Only the fixture module, only this fixture's window; KICKOFF point (offset 0)
    // gives as_of = kickoff = DB_AS_OF (>= seed → version resolves). Earlier points
    // predate the version and are skipped. Committed (idempotent on rerun).
    const report = await runModulePipeline({
      now: DB_AS_OF,
      calculators: [],
      fixtureCalculators: [restAdvantage],
      replayFrom: new Date(DB_AS_OF.getTime() - 86_400_000),
      replayTo: new Date(DB_AS_OF.getTime() + 86_400_000),
    });
    assert.equal(report.failures, 0);
    assert.ok(report.modules.includes('rest_advantage'));
    const found = await withConnection(MODULE_ROLE, (tx) =>
      tx.query(`SELECT module_status_code, verdict_text FROM module.module_reading
                 WHERE subject_fixture_id=$1::bigint AND as_of=$2`, [fixtureId, DB_AS_OF]));
    assert.equal(found.rows.length, 1, 'exactly one engaged rest reading at the KICKOFF instant');
    assert.equal(found.rows[0].module_status_code, 'SUPPORTS');
    assert.match(found.rows[0].verdict_text, /Home fresher/);
    // Idempotent rerun.
    const rerun = await runModulePipeline({
      now: DB_AS_OF, calculators: [], fixtureCalculators: [restAdvantage],
      replayFrom: new Date(DB_AS_OF.getTime() - 86_400_000), replayTo: new Date(DB_AS_OF.getTime() + 86_400_000),
    });
    assert.equal(rerun.failures, 0);
  });

  it('S-7 compatibility: the sealed schema accepts the FIXTURE reading + both cited rest values', async () => {
    // Proven by a direct insert into the sealed family (rolled back). It uses NO
    // S-7 code and changes nothing: it demonstrates the reading is structurally
    // sealable. (Auto-selection of FIXTURE readings by S-7 is the S-7.x follow-up.)
    await inRolledBackModuleTx(async (tx) => {
      const { reading } = await fixtureReading(tx, DB_AS_OF);
      // The engine-integration test may already have committed this reading; either
      // way (fresh write here, or pre-existing) the row exists for the citation.
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
      // Cite the FIXTURE reading — the sealed schema accepts a non-TEAM subject reading.
      const smr = await tx.query(
        `INSERT INTO snapshot.snapshot_module_reading
           (fixture_partition_on, match_snapshot_id, snapshot_as_of, cited_module_reading_id, cited_as_of)
         VALUES ($1::date,$2::bigint,$3::timestamptz,$4::bigint,$3::timestamptz) RETURNING id`,
        [partitionOn, snapId, DB_AS_OF.toISOString(), rid]);
      assert.equal(smr.rowCount, 1, 'snapshot_module_reading cites the FIXTURE reading');
      // Both cited rest feature values seal into snapshot_feature_state.
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
    });
  });
});
