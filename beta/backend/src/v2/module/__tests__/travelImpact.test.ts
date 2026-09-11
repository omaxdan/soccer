// ─────────────────────────────────────────────────────────────────────────────
// S-6 travel_impact — the third FIXTURE-subject COMPARISON module
//
// PURE tests pin the home-relative signed comparison (Decision 2: gap =
// away.travel_distance − home.travel_distance; away farther → SUPPORTS "Away
// travelled … farther", home farther → CONTRADICTS, equal → NEUTRAL), the
// two-input (D-4a) declared/present counts, MIN(consumed) sample, INACTIVE on a
// missing side, and the FIXTURE subject shape. It consumes team.travel_distance
// (Decision 1), NOT team.travel_impact. DB tests prove the production path (read
// both teams' team.travel_distance → assemble → write) persists a FIXTURE reading
// citing BOTH sides, with strength/confidence/published_baseline_id NULL (Decision
// 3), as-of safety, engine integration, and S-7 sealing compatibility.
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
import { fromInt } from '../../feature/write/scale';
import { PROVIDER_CODE } from '../../ingestion/provider/config';

import { travelImpact } from '../calculators/travelImpact';
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

import { testDatabaseReady } from '../../db/testSupport';
const hasDatabase = testDatabaseReady();
const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
const FEATURE_ROLE = 'pt_pipeline_feature' as const;
const MODULE_ROLE = 'pt_pipeline_module' as const;

const DIST = 'team.travel_distance';
const AS_OF = new Date('2027-05-02T00:00:00Z');

// ─── the pure calculator + assembly ──────────────────────────────────────────

function distInput(km: number, count = 1, id = 'D'): Map<string, ConsumedFeature> {
  return new Map([[DIST, { featureKey: DIST, valueId: id, asOf: AS_OF, value: fromInt(km), sampleObservationCount: count }]]);
}
function findingFor(homeKm: number, awayKm: number) {
  return travelImpact.evaluate({ home: distInput(homeKm), away: distInput(awayKm) });
}

const DEF = {
  moduleKey: 'travel_impact',
  moduleDefinitionId: '5',
  subjectKindCode: 'FIXTURE',
  calibrationModeCode: 'OUTCOME_SCORED',
  outcomeDimensionCode: 'MATCH_RESULT',
  isActive: true,
};
const VERSION = { moduleVersionId: '50', designation: '1.0.0', minimumSampleObservationCount: 0 };

function assembleFor(
  home: Map<string, ConsumedFeature>,
  away: Map<string, ConsumedFeature>,
  version = VERSION
) {
  return assembleFixtureReading({
    calculator: travelImpact,
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

describe('travel_impact — pure home-relative signed comparison and assembly', () => {
  it('1. away travelled farther → SUPPORTS ("Away travelled … farther")', () => {
    const f = findingFor(100, 500); // home 100km, away 500km → gap +400
    assert.equal(f.status, 'SUPPORTS');
    assert.match(f.verdictText, /Away travelled/);
    assert.match(f.verdictText, /400 km/);
  });
  it('2. home travelled farther → CONTRADICTS ("Home travelled … farther")', () => {
    const f = findingFor(600, 150); // gap −450
    assert.equal(f.status, 'CONTRADICTS');
    assert.match(f.verdictText, /Home travelled/);
    assert.match(f.verdictText, /450 km/);
  });
  it('3. equal distance → NEUTRAL ("Even travel")', () => {
    const f = findingFor(300, 300);
    assert.equal(f.status, 'NEUTRAL');
    assert.match(f.verdictText, /Even travel/);
  });
  it('a genuine 0 km both sides is a real NEUTRAL value (never INACTIVE)', () => {
    const f = findingFor(0, 0);
    assert.equal(f.status, 'NEUTRAL');
  });
  it('is deterministic and declares its input (D-3/D-4): team.travel_distance, FIXTURE, ALL_COMPETITIONS', () => {
    assert.deepEqual(findingFor(100, 500), findingFor(100, 500));
    assert.deepEqual([...travelImpact.inputFeatureKeys], [DIST]);
    assert.equal(travelImpact.subjectKind, 'FIXTURE');
    assert.equal(travelImpact.contextKind, CALCULATION_CONTEXT_KIND);
  });

  it('9. correct orientation: swapping the sides flips SUPPORTS↔CONTRADICTS (inverted vs rest)', () => {
    assert.equal(findingFor(100, 500).status, 'SUPPORTS');  // away farther favours home
    assert.equal(findingFor(500, 100).status, 'CONTRADICTS'); // home farther is against home
  });

  it('assembly: two declared inputs (D-4a), both present, one item per side, MIN sample, FIXTURE subject', () => {
    const r = assembleFor(distInput(100, 1, 'H'), distInput(500, 1, 'A'));
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
    assert.equal(r.evidenceItems.length, 2, 'both sides’ travel_distance values cited');
    assert.deepEqual(r.evidenceItems.map((e) => e.citedFeatureValueId).sort(), ['A', 'H']);
    assert.ok(r.evidenceItems.every((e) => e.contributionDirection === 'SUPPORTS'));
  });

  it('4+11. missing home input → INACTIVE, FEATURE_ABSENT, no items, no fabricated zero', () => {
    const r = assembleFor(new Map(), distInput(500, 1, 'A'));
    assert.equal(r.statusCode, 'INACTIVE');
    assert.equal(r.inactiveReason, INACTIVE_REASON_FEATURE_ABSENT);
    assert.equal(r.verdictText, null);
    assert.equal(r.declaredInputCount, 2);
    assert.equal(r.presentInputCount, 1, 'only away present');
    assert.equal(r.sampleObservationCount, 0);
    assert.equal(r.evidenceItems.length, 0);
  });
  it('5. missing away input → INACTIVE (one-side-present is INACTIVE under the current engine — doc-70 "still speaks" deferred to S-9)', () => {
    assert.equal(assembleFor(distInput(100, 1, 'H'), new Map()).statusCode, 'INACTIVE');
  });
  it('6. both inputs missing → INACTIVE', () => {
    const r = assembleFor(new Map(), new Map());
    assert.equal(r.statusCode, 'INACTIVE');
    assert.equal(r.presentInputCount, 0);
  });

  it('7. below-threshold sample stays honestly low-sample (not upgraded)', () => {
    const strictVersion = { moduleVersionId: '50', designation: '1.0.0', minimumSampleObservationCount: 2 };
    const r = assembleFor(distInput(100, 1, 'H'), distInput(500, 1, 'A'), strictVersion);
    assert.equal(r.statusCode, 'SUPPORTS', 'still engaged — the finding stands');
    assert.equal(r.sampleObservationCount, 1);
    assert.equal(r.sampleMeetsThreshold, false, 'MIN sample 1 < version minimum 2 → below threshold, not upgraded');
  });
  it('13. sample is MIN of the two sides', () => {
    const r = assembleFor(distInput(100, 5, 'H'), distInput(500, 2, 'A'));
    assert.equal(r.sampleObservationCount, 2);
  });

  it('registration: travel_impact is the third FIXTURE calculator; the TEAM set is unchanged', () => {
    assert.deepEqual([...FIXTURE_MODULE_CALCULATORS.map((c) => c.moduleKey)], ['rest_advantage', 'form_gap_accuracy', 'travel_impact']);
    assert.deepEqual([...MODULE_CALCULATORS.map((c) => c.moduleKey)].sort(), ['consistency_index', 'giant_killer_index', 'home_away_split', 'readiness_tracker']);
  });
});

// ─── DB: production path, engine integration, and S-7 sealing compatibility ───

// Run-unique so the committed fixture/edition/team rows (and the engine-integration
// reading) never collide with a prior run on a reused database.
const TI = 'S6TI' + (Date.now() % 1_000_000);

describe('travel_impact against the DB (FIXTURE-subject production path)', { skip: !hasDatabase }, () => {
  const DB_AS_OF = new Date(Math.floor((Date.now() - 5_000) / 1000) * 1000);
  const LATER = new Date(DB_AS_OF.getTime() + 30 * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  let editionId = '', homeId = '', awayId = '', fixtureId = '', partitionOn = '';

  before(async () => {
    await withConnection(FEATURE_ROLE, (tx) => seedFeatureRegistry(tx));
    await withConnection(INGESTION_ROLE, async (tx) => {
      const comp = await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
         VALUES ($1,$2,'TI League',$3,'GB') RETURNING id::text`, [PROVIDER_CODE, `${TI}-C`, `${TI}-c`.toLowerCase()]);
      const ed = await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1,$2,'TI 2027', daterange('2027-01-01','2029-01-01')) RETURNING id::text`, [comp.rows[0].id, `${TI}-S`]);
      editionId = ed.rows[0].id;
      const team = async (s: string) => (await tx.query<{ id: string }>(
        `INSERT INTO football.team (provider_code, provider_external_id, name, slug, country_code)
         VALUES ($1,$2,$3,$4,'GB') RETURNING id::text`,
        [PROVIDER_CODE, `${TI}-T${s}`, `TI ${s}`, `${TI}-t${s}`.toLowerCase()])).rows[0].id;
      homeId = await team('H'); awayId = await team('A');
      partitionOn = day(DB_AS_OF);
      const fx = await tx.query<{ id: string }>(
        `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
           is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         VALUES ($1,$2,$3::date,$4,false,$5,$6,$7,'SCHEDULED') RETURNING id::text`,
        [PROVIDER_CODE, `${TI}-F`, partitionOn, editionId, homeId, awayId, DB_AS_OF.toISOString()]);
      fixtureId = fx.rows[0].id;
    });
    // Both teams' team.travel_distance at DB_AS_OF (away travelled farther: home 120 vs away 640).
    await withConnection(FEATURE_ROLE, async (tx) => {
      const registry = await loadRegistry(tx);
      const candidates: CandidateValue[] = [
        { featureKey: DIST, teamId: homeId, asOf: DB_AS_OF, value: fromInt(120), sampleObservationCount: 1, consumed: [] },
        { featureKey: DIST, teamId: awayId, asOf: DB_AS_OF, value: fromInt(640), sampleObservationCount: 1, consumed: [] },
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
    const def = registry.definitionsByKey.get('travel_impact')!;
    const version = await resolveModuleVersion(tx, def.moduleDefinitionId, asOf);
    const consumed = await readConsumedFeatures(tx, travelImpact.inputFeatureKeys, [homeId, awayId], asOf, ALL_COMPETITIONS_SCOPE);
    const homeInputs = new Map<string, ConsumedFeature>();
    const awayInputs = new Map<string, ConsumedFeature>();
    for (const k of travelImpact.inputFeatureKeys) {
      const h = consumed.get(consumedKey(k, homeId)); const a = consumed.get(consumedKey(k, awayId));
      if (h) homeInputs.set(k, h); if (a) awayInputs.set(k, a);
    }
    const reading = assembleFixtureReading({
      calculator: travelImpact, definition: def, version: version!, asOf,
      scope: ALL_COMPETITIONS_SCOPE, fixtureId, fixturePartitionOn: partitionOn, homeInputs, awayInputs,
    });
    return { reading, def, version: version! };
  }

  it('the FIXTURE subject contract is registered (subject_kind_code = FIXTURE)', async () => {
    await withConnection(MODULE_ROLE, async (tx) => {
      const registry = await loadModuleRegistry(tx);
      assert.equal(registry.definitionsByKey.get('travel_impact')!.subjectKindCode, 'FIXTURE');
    });
  });

  it('persists a FIXTURE reading (away farther → SUPPORTS) citing BOTH teams; strength/confidence/baseline NULL', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const { reading } = await fixtureReading(tx, DB_AS_OF);
      assert.equal(reading.statusCode, 'SUPPORTS');
      const res = await writeReading(tx, { ...reading, calculatedAt: DB_AS_OF });
      assert.equal(res.written, 1);
      const { rows } = await tx.query(
        `SELECT r.subject_kind_code, r.subject_fixture_id::text fx, r.subject_fixture_partition_on::text part,
                r.subject_team_id, r.context_kind_code, r.context_competition_edition_id ed,
                r.module_status_code, r.verdict_text, r.strength, r.confidence, r.published_baseline_id,
                r.sample_observation_count,
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
      assert.match(rows[0].verdict_text, /Away travelled/);
      assert.equal(rows[0].strength, null);
      assert.equal(rows[0].confidence, null);
      assert.equal(rows[0].published_baseline_id, null);
      assert.equal(rows[0].sample_observation_count, 1);
      assert.equal(rows[0].items, 2, 'both sides cited');
      assert.equal(rows[0].distinct_teams_cited, 2, 'evidence cites home AND away');
    });
  });

  it('as-of safety: a later travel value does not enter the reading at the earlier cutoff', async () => {
    await inRolledBackModuleTx(async (tx) => {
      const registry = await loadRegistry(tx);
      await writeValues(tx, registry, [
        { featureKey: DIST, teamId: homeId, asOf: LATER, value: fromInt(9999), sampleObservationCount: 1, consumed: [] },
      ], LATER);
      const { reading } = await fixtureReading(tx, DB_AS_OF);
      assert.ok(reading.evidenceItems.every((e) => e.citedFeatureValueAsOf.getTime() <= DB_AS_OF.getTime()));
      assert.equal(reading.statusCode, 'SUPPORTS', 'still home 120 vs away 640, not the future 9999');
    });
  });

  it('engine integration: runModulePipeline produces the travel reading for the fixture', async () => {
    const report = await runModulePipeline({
      now: DB_AS_OF,
      calculators: [],
      fixtureCalculators: [travelImpact],
      replayFrom: new Date(DB_AS_OF.getTime() - 86_400_000),
      replayTo: new Date(DB_AS_OF.getTime() + 86_400_000),
    });
    assert.equal(report.failures, 0);
    assert.ok(report.modules.includes('travel_impact'));
    const found = await withConnection(MODULE_ROLE, (tx) =>
      tx.query(`SELECT module_status_code, verdict_text FROM module.module_reading
                 WHERE subject_fixture_id=$1::bigint AND as_of=$2`, [fixtureId, DB_AS_OF]));
    assert.equal(found.rows.length, 1, 'exactly one engaged travel reading at the KICKOFF instant');
    assert.equal(found.rows[0].module_status_code, 'SUPPORTS');
    assert.match(found.rows[0].verdict_text, /Away travelled/);
    const rerun = await runModulePipeline({
      now: DB_AS_OF, calculators: [], fixtureCalculators: [travelImpact],
      replayFrom: new Date(DB_AS_OF.getTime() - 86_400_000), replayTo: new Date(DB_AS_OF.getTime() + 86_400_000),
    });
    assert.equal(rerun.failures, 0);
  });
});
