// S-7.x — sealing FIXTURE-subject module readings (rest_advantage). DB-gated,
// with a DB-free SQL-shape guard.
//
// Proves the bounded S-7 selection extension: the existing sealing machinery now
// auto-selects and seals a FIXTURE-subject reading alongside the TEAM readings,
// WITHOUT a second sealing path, WITHOUT changing checksum/immutability/verdict
// semantics, and WITHOUT populating any edge/risk/confidence. TEAM selection is
// unchanged; subject identity is preserved (no suppression across subjects).

import { after, before, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { loadRegistry } from '../../feature/registry/load';
import { writeValues } from '../../feature/write/values';
import { fromInt } from '../../feature/write/scale';
import { COMPETITION_SCOPED_CONTEXT_KIND, ALL_COMPETITIONS_SCOPE, type CalculationScope } from '../../feature/calculators/types';
import { homeAwaySplit } from '../../module/calculators/homeAwaySplit';
import { readinessTracker } from '../../module/calculators/readinessTracker';
import { restAdvantage } from '../../module/calculators/restAdvantage';
import { assembleReading, assembleFixtureReading } from '../../module/pipeline';
import { loadModuleRegistry, resolveModuleVersion } from '../../module/registry/load';
import { readConsumedFeatures, consumedKey } from '../../module/read/consumedFeatures';
import { writeReading } from '../../module/write/readings';
import type { ModuleCalculator, ConsumedFeature } from '../../module/types';

import { readSpokeReadings } from '../read/selection';
import { runSnapshotSealing } from '../driver';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);

// ─────────────────────────────────────────────────────────────────────────────
// DB-FREE: the selection SQL is subject-aware and binds the fixture id ($4).
// ─────────────────────────────────────────────────────────────────────────────
function captureTx(rows: unknown[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  const tx = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows }; } } as unknown as PoolClient;
  return { tx, calls };
}

describe('S-7.x selection · subject-aware SQL shape (DB-free)', () => {
  test('selects TEAM readings for the teams OR FIXTURE readings for the fixture; binds $4', async () => {
    const { tx, calls } = captureTx([]);
    await readSpokeReadings(tx, { teamIds: ['10', '11'], asOf: new Date('2027-07-01T00:00:00Z'), competitionEditionId: '42', fixtureId: '500' });
    const sql = calls[0].sql;
    // subject-aware predicate: TEAM by team ids, or FIXTURE by fixture id
    assert.match(sql, /mr\.subject_kind_code = 'TEAM' AND mr\.subject_team_id = ANY\(\$1::bigint\[\]\)/);
    assert.match(sql, /mr\.subject_kind_code = 'FIXTURE' AND mr\.subject_fixture_id = \$4::bigint/);
    // DISTINCT ON leads with the subject columns so no cross-subject suppression
    assert.match(sql, /DISTINCT ON \(mr\.subject_kind_code, mr\.subject_team_id, mr\.subject_fixture_id,/);
    // unchanged as-of + engaged + context discipline
    assert.match(sql, /mr\.as_of <= \$2::timestamptz/);
    assert.match(sql, /mr\.module_status_code <> 'INACTIVE'/);
    assert.match(sql, /context_competition_edition_id IS NULL[\s\S]*\$3::bigint IS NULL/);
    assert.deepEqual(calls[0].params, [['10', '11'], new Date('2027-07-01T00:00:00Z'), '42', '500']);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB-GATED
// ─────────────────────────────────────────────────────────────────────────────
describe('S-7.x sealing FIXTURE readings over a real database', { skip: !hasDatabase }, () => {
  const INGESTION = 'pt_pipeline_ingestion' as const;
  const FEATURE = 'pt_pipeline_feature' as const;
  const MODULE = 'pt_pipeline_module' as const;
  const TAG = String(Date.now() % 1_000_000);
  const KICKOFF = new Date(Math.floor((Date.now() - 5_000) / 1000) * 1000); // sealable (<= now, after seed)
  const AS_OF = KICKOFF;
  const LATER = new Date(KICKOFF.getTime() + 40 * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const iso = (d: Date) => d.toISOString();
  const scoped = (ed: string): CalculationScope => ({ contextKind: COMPETITION_SCOPED_CONTEXT_KIND, contextEditionId: ed });

  let editionId = '', teamA = '', teamB = '', fixtureId = '', partitionOn = '';

  async function produceTeamReading(tx: PoolClient, key: string, calc: ModuleCalculator, teamId: string, scope: CalculationScope, asOf: Date) {
    const reg = await loadModuleRegistry(tx);
    const def = reg.definitionsByKey.get(key)!;
    const version = await resolveModuleVersion(tx, def.moduleDefinitionId, asOf);
    const consumed = await readConsumedFeatures(tx, calc.inputFeatureKeys, [teamId], asOf, scope);
    const inputs = new Map<string, ConsumedFeature>();
    for (const k of calc.inputFeatureKeys) { const v = consumed.get(consumedKey(k, teamId)); if (v) inputs.set(k, v); }
    await writeReading(tx, { ...assembleReading({ calculator: calc, definition: def, version: version!, asOf, scope, teamId, inputs }), calculatedAt: asOf });
  }
  async function produceRestReading(tx: PoolClient, asOf: Date) {
    const reg = await loadModuleRegistry(tx);
    const def = reg.definitionsByKey.get('rest_advantage')!;
    const version = await resolveModuleVersion(tx, def.moduleDefinitionId, asOf);
    const consumed = await readConsumedFeatures(tx, restAdvantage.inputFeatureKeys, [teamA, teamB], asOf, ALL_COMPETITIONS_SCOPE);
    const homeInputs = new Map<string, ConsumedFeature>(); const awayInputs = new Map<string, ConsumedFeature>();
    for (const k of restAdvantage.inputFeatureKeys) {
      const h = consumed.get(consumedKey(k, teamA)); const a = consumed.get(consumedKey(k, teamB));
      if (h) homeInputs.set(k, h); if (a) awayInputs.set(k, a);
    }
    await writeReading(tx, {
      ...assembleFixtureReading({ calculator: restAdvantage, definition: def, version: version!, asOf,
        scope: ALL_COMPETITIONS_SCOPE, fixtureId, fixturePartitionOn: partitionOn, homeInputs, awayInputs }),
      calculatedAt: asOf,
    });
  }

  before(async () => {
    await withConnection(INGESTION, async (tx) => {
      const comp = await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
         VALUES ('SPORTSAPI_API',$1,'S7x League',$2,'GB') RETURNING id::text`, [`S7X-C-${TAG}`, `s7x-c-${TAG}`]);
      const ed = await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1,$2,'S7x', daterange('2026-01-01','2029-01-01')) RETURNING id::text`, [comp.rows[0].id, `S7X-S-${TAG}`]);
      editionId = ed.rows[0].id;
      const team = async (s: string) => (await tx.query<{ id: string }>(
        `INSERT INTO football.team (provider_code, provider_external_id, name, slug) VALUES ('SPORTSAPI_API',$1,$2,$3) RETURNING id::text`,
        [`S7X-T${s}-${TAG}`, `S7x ${s}`, `s7x-${s}-${TAG}`])).rows[0].id;
      teamA = await team('A'); teamB = await team('B');
      partitionOn = day(KICKOFF);
      const fx = await tx.query<{ id: string }>(
        `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
           is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         VALUES ('SPORTSAPI_API',$1,$2::date,$3,false,$4,$5,$6,'SCHEDULED') RETURNING id::text`,
        [`S7X-F-${TAG}`, partitionOn, editionId, teamA, teamB, iso(KICKOFF)]);
      fixtureId = fx.rows[0].id;
    });
    await withConnection(FEATURE, async (tx) => {
      const reg = await loadRegistry(tx);
      await writeValues(tx, reg, [
        { featureKey: 'team.home_win_rate', teamId: teamA, asOf: AS_OF, value: fromInt(80), sampleObservationCount: 8, consumed: [] },
        { featureKey: 'team.away_win_rate', teamId: teamA, asOf: AS_OF, value: fromInt(20), sampleObservationCount: 8, consumed: [] },
        { featureKey: 'team.home_win_rate', teamId: teamB, asOf: AS_OF, value: fromInt(50), sampleObservationCount: 8, consumed: [] },
        { featureKey: 'team.away_win_rate', teamId: teamB, asOf: AS_OF, value: fromInt(50), sampleObservationCount: 8, consumed: [] },
      ], AS_OF, scoped(editionId));
      await writeValues(tx, reg, [
        { featureKey: 'team.momentum', teamId: teamA, asOf: AS_OF, value: fromInt(15), sampleObservationCount: 10, consumed: [] },
        { featureKey: 'team.momentum', teamId: teamB, asOf: AS_OF, value: fromInt(-12), sampleObservationCount: 10, consumed: [] },
        { featureKey: 'team.rest_advantage', teamId: teamA, asOf: AS_OF, value: fromInt(6), sampleObservationCount: 1, consumed: [] },
        { featureKey: 'team.rest_advantage', teamId: teamB, asOf: AS_OF, value: fromInt(3), sampleObservationCount: 1, consumed: [] },
      ], AS_OF);
    });
    await withConnection(MODULE, async (tx) => {
      for (const t of [teamA, teamB]) {
        await produceTeamReading(tx, 'home_away_split', homeAwaySplit, t, scoped(editionId), AS_OF);
        await produceTeamReading(tx, 'readiness_tracker', readinessTracker, t, ALL_COMPETITIONS_SCOPE, AS_OF);
      }
      await produceRestReading(tx, AS_OF); // the FIXTURE-subject reading
    });
    await runSnapshotSealing({ fixtureId, now: KICKOFF });
  });
  after(async () => { await closeAllPools(); });

  const kickoffSnapshot = () => withConnection(MODULE, async (tx) =>
    (await tx.query<{ id: string }>(`SELECT id::text FROM snapshot.match_snapshot WHERE fixture_id=$1 AND snapshot_point_code='KICKOFF'`, [fixtureId])).rows[0]);

  it('(1,3) auto-selects the FIXTURE rest reading AND both teams’ TEAM readings — no suppression', async () => {
    const ms = await kickoffSnapshot();
    assert.ok(ms, 'a KICKOFF snapshot was sealed');
    const rows = await withConnection(MODULE, (tx) => tx.query<{ kind: string; team: string | null; fx: string | null; module_key: string }>(
      `SELECT mr.subject_kind_code kind, mr.subject_team_id::text team, mr.subject_fixture_id::text fx, md.module_key
         FROM snapshot.snapshot_module_reading smr
         JOIN module.module_reading mr ON mr.id=smr.cited_module_reading_id AND mr.as_of=smr.cited_as_of
         JOIN module.module_definition md ON md.id=mr.module_definition_id
        WHERE smr.match_snapshot_id=$1 AND smr.fixture_partition_on=$2::date
        ORDER BY md.module_key, mr.subject_team_id`, [ms.id, partitionOn]));
    const cited = rows.rows;
    // 4 TEAM readings (home_away × 2 teams, readiness × 2 teams) + 1 FIXTURE rest.
    const team = cited.filter((r) => r.kind === 'TEAM');
    const fixture = cited.filter((r) => r.kind === 'FIXTURE');
    assert.equal(team.length, 4, 'both teams’ home_away_split and readiness_tracker still sealed (TEAM regression)');
    assert.equal(fixture.length, 1, 'exactly one FIXTURE rest_advantage reading sealed');
    assert.equal(fixture[0].module_key, 'rest_advantage');
    assert.equal(fixture[0].fx, fixtureId, 'the FIXTURE reading points to the fixture');
    assert.equal(fixture[0].team, null, 'the FIXTURE reading is not attributed to a team');
    // Both teams represented among the TEAM readings — neither suppressed the other.
    assert.equal(new Set(team.map((r) => r.team)).size, 2, 'both teams present');
  });

  it('(7) both rest feature values are sealed into snapshot_feature_state (lineage preserved)', async () => {
    const ms = await kickoffSnapshot();
    const n = await withConnection(MODULE, (tx) => tx.query<{ n: string }>(
      `SELECT count(*)::text n
         FROM snapshot.snapshot_feature_state sfs
         JOIN feature.feature_value fv ON fv.id=sfs.cited_feature_value_id AND fv.as_of=sfs.cited_as_of
         JOIN feature.feature_definition d ON d.id=fv.feature_definition_id
        WHERE sfs.match_snapshot_id=$1 AND sfs.fixture_partition_on=$2::date
          AND d.feature_key='team.rest_advantage' AND fv.subject_team_id = ANY($3::bigint[])`,
      [ms.id, partitionOn, [teamA, teamB]]));
    assert.equal(Number(n.rows[0].n), 2, 'home and away team.rest_advantage both sealed via the existing lineage');
  });

  it('(5) as-of: every cited row is at or before the snapshot as_of (no future contamination)', async () => {
    const ms = await kickoffSnapshot();
    const ok = await withConnection(MODULE, async (tx) => {
      const a = await tx.query<{ ok: boolean }>(
        `SELECT bool_and(smr.cited_as_of <= s.snapshot_as_of) ok FROM snapshot.match_snapshot s
           JOIN snapshot.snapshot_module_reading smr ON smr.match_snapshot_id=s.id AND smr.fixture_partition_on=s.fixture_partition_on
          WHERE s.id=$1`, [ms.id]);
      const b = await tx.query<{ ok: boolean }>(
        `SELECT bool_and(sfs.cited_as_of <= s.snapshot_as_of) ok FROM snapshot.match_snapshot s
           JOIN snapshot.snapshot_feature_state sfs ON sfs.match_snapshot_id=s.id AND sfs.fixture_partition_on=s.fixture_partition_on
          WHERE s.id=$1`, [ms.id]);
      return a.rows[0].ok !== false && b.rows[0].ok !== false;
    });
    assert.ok(ok, 'all cited readings and feature values are ≤ snapshot as_of');
  });

  it('(8) under 1.1.0 the FIXTURE reading populates ONLY rest_edge; every other edge/risk/confidence/reliability stays NULL', async () => {
    const ms = await kickoffSnapshot();
    // Home (teamA) rest 6, away (teamB) rest 3 → rest_edge = 6 − 3 = 3.
    const row = await withConnection(MODULE, (tx) => tx.query<{ rest: string | null; others: string }>(
      `SELECT rest_edge::text rest,
              (CASE WHEN readiness_edge IS NULL AND form_edge IS NULL AND travel_edge IS NULL
                     AND congestion_edge IS NULL AND availability_edge IS NULL
                     AND risk_score IS NULL AND confidence IS NULL AND historical_reliability_baseline_id IS NULL
                    THEN 'all-null' ELSE 'leaked' END) others
         FROM snapshot.snapshot_verdict
        WHERE match_snapshot_id=$1 AND fixture_partition_on=$2::date`,
      [ms.id, partitionOn]));
    assert.equal(Number(row.rows[0].rest), 3, 'rest_edge = home − away rest_advantage (6 − 3)');
    assert.equal(row.rows[0].others, 'all-null', 'no OTHER edge/risk/confidence/reliability populated');
    // Snapshot resolved to the 1.1.0 composition version (the one that governs rest_edge).
    const ver = await withConnection(MODULE, (tx) => tx.query<{ d: string }>(
      `SELECT vv.designation d FROM snapshot.match_snapshot ms
         JOIN module.verdict_composition_version vv ON vv.id=ms.verdict_composition_version_id
        WHERE ms.id=$1`, [ms.id]));
    assert.equal(ver.rows[0].d, '1.2.0', 'sealed under the current composition version (1.2.0), which governs rest_edge');
    // rest is an engaged module: evidence_count includes the 5 spoke readings.
    const v = await withConnection(MODULE, (tx) => tx.query<{ ev: string }>(
      `SELECT evidence_count::text ev FROM snapshot.snapshot_verdict WHERE match_snapshot_id=$1 AND fixture_partition_on=$2::date`, [ms.id, partitionOn]));
    assert.equal(Number(v.rows[0].ev), 5, 'four TEAM readings + one FIXTURE reading are counted as engaged evidence');
  });

  it('(9,10) idempotent rerun; the sealed snapshot is not mutated', async () => {
    const before = await kickoffSnapshot();
    const rerun = await runSnapshotSealing({ fixtureId, now: KICKOFF });
    assert.equal(rerun.sealed, 0, 're-running seals nothing new');
    assert.ok(rerun.skipped > 0, 'the existing snapshot is skipped, not duplicated');
    const afterId = (await kickoffSnapshot()).id;
    assert.equal(afterId, before.id, 'same snapshot id — not re-created');
    // Immutability still holds for the whole family.
    await withConnection(MODULE, async (tx) => {
      await assert.rejects(
        tx.query(`UPDATE snapshot.snapshot_module_reading SET cited_module_reading_id=cited_module_reading_id WHERE match_snapshot_id=$1`, [before.id]),
        /sealed content is immutable/
      );
    });
  });

  it('as-of exclusion: a later rest reading is not cited by the already-sealed earlier snapshot', async () => {
    // Produce a LATER rest reading (as_of after the snapshot). The sealed KICKOFF
    // snapshot must still cite only the earlier rest reading.
    await withConnection(FEATURE, async (tx) => {
      const reg = await loadRegistry(tx);
      await writeValues(tx, reg, [
        { featureKey: 'team.rest_advantage', teamId: teamA, asOf: LATER, value: fromInt(1), sampleObservationCount: 1, consumed: [] },
        { featureKey: 'team.rest_advantage', teamId: teamB, asOf: LATER, value: fromInt(9), sampleObservationCount: 1, consumed: [] },
      ], LATER);
    });
    await withConnection(MODULE, (tx) => produceRestReading(tx, LATER));
    const ms = await kickoffSnapshot();
    const citedAsOfs = await withConnection(MODULE, (tx) => tx.query<{ as_of: Date }>(
      `SELECT smr.cited_as_of as_of FROM snapshot.snapshot_module_reading smr
         JOIN module.module_reading mr ON mr.id=smr.cited_module_reading_id AND mr.as_of=smr.cited_as_of
        WHERE smr.match_snapshot_id=$1 AND mr.subject_kind_code='FIXTURE'`, [ms.id]));
    assert.equal(citedAsOfs.rows.length, 1);
    assert.equal(citedAsOfs.rows[0].as_of.getTime(), AS_OF.getTime(), 'the earlier rest reading is cited, never the later one');
  });
});
