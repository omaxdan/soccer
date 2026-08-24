// S-7 SEALING — DB-GATED (skip without PT_V2_DB_*).
//
// Proves the historical-sealing contract end-to-end against a migrated PG16:
//   1. real migrations support sealing (the family inserts under all FK/checks)
//   2. real module readings are selected and cited
//   3. feature-value lineage is captured via the readings' evidence
//   4. every sealed row satisfies the schema (the transaction commits)
//   5. the content checksum is stored and reproducible from the same content
//   6. sealed snapshots cannot be mutated (UPDATE/DELETE raise)
//   7. a later source value does not contaminate an earlier snapshot (as-of)
//   8. a newer rule version yields a DISTINCT snapshot, not a mutation
//   9. completeness records eligible-but-absent modules honestly
//  10. no directional edge / risk / confidence is fabricated (all NULL)
//
// Readings/evidence are produced by the SAME production path the module pipeline
// uses (assembleReading → writeReading). Nothing is mocked.

import { after, before, describe, it } from 'node:test';
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
import { assembleReading } from '../../module/pipeline';
import { loadModuleRegistry, resolveModuleVersion } from '../../module/registry/load';
import { readConsumedFeatures, consumedKey } from '../../module/read/consumedFeatures';
import { writeReading } from '../../module/write/readings';
import type { ModuleCalculator } from '../../module/types';

import { runSnapshotSealing } from '../driver';
import {
  readSpokeReadings, readEligibleModules, resolveVersionInForce,
} from '../read/selection';
import { tallyConsensus, computeCompleteness, buildManifest } from '../verdict';
import { buildContent, sealSnapshot } from '../seal';
import { contentChecksum } from '../canonical';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);

describe('S-7 sealing over a real migrated database', { skip: !hasDatabase }, () => {
  const INGESTION = 'pt_pipeline_ingestion' as const;
  const FEATURE = 'pt_pipeline_feature' as const;
  const MODULE = 'pt_pipeline_module' as const;
  const TAG = String(Date.now() % 1_000_000);
  // The KICKOFF snapshot's as-of must fall in [seed time, wall clock now]:
  //   • >= seed time  — so the feature/module versions are in force at as-of
  //                     (module_reading/feature_value reference the current version);
  //   • <= now        — so match_snapshot's sealed_at >= snapshot_as_of holds
  //                     (a snapshot cannot describe a future moment).
  // Seed always precedes the test run, so "a few seconds ago" satisfies both. The
  // T-7d/-3d/-1d points fall before seed time and are correctly skipped (no rule).
  const KICKOFF = new Date(Math.floor((Date.now() - 5_000) / 1000) * 1000);
  const AS_OF = KICKOFF; // readings/values at the kickoff instant (whole seconds)
  const LATER = new Date(KICKOFF.getTime() + 30 * 86_400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const iso = (d: Date) => d.toISOString();
  const scoped = (ed: string): CalculationScope => ({ contextKind: COMPETITION_SCOPED_CONTEXT_KIND, contextEditionId: ed });

  let editionId = '', teamA = '', teamB = '', fixtureId = '', partitionOn = '';
  let bareFixtureId = '', barePartitionOn = '';

  async function produceReading(tx: PoolClient, key: string, calc: ModuleCalculator, teamId: string, scope: CalculationScope, asOf: Date) {
    const reg = await loadModuleRegistry(tx);
    const def = reg.definitionsByKey.get(key)!;
    const version = await resolveModuleVersion(tx, def.moduleDefinitionId, asOf);
    const consumed = await readConsumedFeatures(tx, calc.inputFeatureKeys, [teamId], asOf, scope);
    const inputs = new Map();
    for (const k of calc.inputFeatureKeys) { const v = consumed.get(consumedKey(k, teamId)); if (v) inputs.set(k, v); }
    const reading = assembleReading({ calculator: calc, definition: def, version: version!, asOf, scope, teamId, inputs });
    await writeReading(tx, { ...reading, calculatedAt: asOf });
  }

  before(async () => {
    await withConnection(INGESTION, async (tx) => {
      const comp = await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
         VALUES ('SPORTSAPI_API',$1,'S7 League',$2,'GB') ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET name=EXCLUDED.name RETURNING id::text`,
        [`S7-COMP-${TAG}`, `s7-league-${TAG}`]);
      const ed = await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1,$2,'S7 2027', daterange('2027-01-01','2029-01-01')) ON CONFLICT (provider_external_id) DO UPDATE SET season_label=EXCLUDED.season_label RETURNING id::text`,
        [comp.rows[0].id, `S7-S-${TAG}`]);
      editionId = ed.rows[0].id;
      const team = async (s: string) => (await tx.query<{ id: string }>(
        `INSERT INTO football.team (provider_code, provider_external_id, name, slug)
         VALUES ('SPORTSAPI_API',$1,$2,$3) ON CONFLICT (provider_code, provider_external_id) DO UPDATE SET name=EXCLUDED.name RETURNING id::text`,
        [`S7-T${s}-${TAG}`, `S7 ${s}`, `s7-${s}-${TAG}`])).rows[0].id;
      teamA = await team('A'); teamB = await team('B');
      const teamC = await team('C'); const teamD = await team('D');
      const f = await tx.query<{ id: string; p: string }>(
        `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
           is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         VALUES ('SPORTSAPI_API',$1,$2::date,$3,false,$4,$5,$6,'SCHEDULED')
         ON CONFLICT (provider_code, provider_external_id, fixture_partition_on) DO UPDATE SET lifecycle_state_code=EXCLUDED.lifecycle_state_code
         RETURNING id::text, fixture_partition_on::text p`,
        [`S7-F-${TAG}`, day(KICKOFF), editionId, teamA, teamB, iso(KICKOFF)]);
      fixtureId = f.rows[0].id; partitionOn = f.rows[0].p;
      // A bare fixture whose teams have NO readings — proves the honest empty seal.
      const bf = await tx.query<{ id: string; p: string }>(
        `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
           is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         VALUES ('SPORTSAPI_API',$1,$2::date,$3,false,$4,$5,$6,'SCHEDULED')
         ON CONFLICT (provider_code, provider_external_id, fixture_partition_on) DO UPDATE SET lifecycle_state_code=EXCLUDED.lifecycle_state_code
         RETURNING id::text, fixture_partition_on::text p`,
        [`S7-BARE-${TAG}`, day(KICKOFF), editionId, teamC, teamD, iso(KICKOFF)]);
      bareFixtureId = bf.rows[0].id; barePartitionOn = bf.rows[0].p;
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
      ], AS_OF);
    });
    await withConnection(MODULE, async (tx) => {
      for (const t of [teamA, teamB]) {
        await produceReading(tx, 'home_away_split', homeAwaySplit, t, scoped(editionId), AS_OF);
        await produceReading(tx, 'readiness_tracker', readinessTracker, t, ALL_COMPETITIONS_SCOPE, AS_OF);
      }
    });
    // Seal at now = KICKOFF. The KICKOFF point (as_of = KICKOFF, after seed time)
    // seals; earlier points (as_of before the rules' genesis on this fresh DB) are
    // skipped as NO_RULE_IN_FORCE. The bare fixture's KICKOFF seals an empty verdict.
    await runSnapshotSealing({ fixtureId, now: KICKOFF });
    await runSnapshotSealing({ fixtureId: bareFixtureId, now: KICKOFF });
  });
  after(async () => { await closeAllPools(); });

  it('(1,4) seals the KICKOFF snapshot and (9) records eligible-but-absent modules', async () => {
    const row = await withConnection(MODULE, async (tx) => {
      const ms = await tx.query<{ id: string; as_of: Date }>(
        `SELECT id::text, snapshot_as_of as_of FROM snapshot.match_snapshot
          WHERE fixture_id=$1 AND snapshot_point_code='KICKOFF'`, [fixtureId]);
      assert.equal(ms.rows.length, 1, 'exactly one KICKOFF snapshot');
      const v = await tx.query(`SELECT * FROM snapshot.snapshot_verdict WHERE match_snapshot_id=$1 AND fixture_partition_on=$2::date`, [ms.rows[0].id, partitionOn]);
      const comp = await tx.query(`SELECT * FROM snapshot.snapshot_completeness WHERE match_snapshot_id=$1 AND fixture_partition_on=$2::date`, [ms.rows[0].id, partitionOn]);
      const items = await tx.query(`SELECT absence_kind, count(*)::int n FROM snapshot.snapshot_completeness_item i
         JOIN snapshot.snapshot_completeness c ON c.id=i.snapshot_completeness_id AND c.fixture_partition_on=i.fixture_partition_on
        WHERE c.match_snapshot_id=$1 AND c.fixture_partition_on=$2::date GROUP BY absence_kind`, [ms.rows[0].id, partitionOn]);
      return { ms: ms.rows[0], v: v.rows[0] as any, comp: comp.rows[0] as any, items: items.rows as any[] };
    });
    assert.equal(Number(row.v.evidence_count), 4, 'four spoke readings (2 modules × 2 teams)');
    assert.equal(Number(row.v.consensus_supports_count) + Number(row.v.consensus_contradicts_count) + Number(row.v.consensus_neutral_count), 4);
    assert.equal(Number(row.comp.engaged_module_count), 2, 'home_away_split + readiness_tracker engaged');
    assert.ok(Number(row.comp.expected_module_count) >= 2, 'eligible-active modules counted');
    // The eligible-but-unimplemented active modules are recorded as MODULE_INACTIVE.
    const inactive = row.items.find((i) => i.absence_kind === 'MODULE_INACTIVE');
    assert.ok(inactive && inactive.n >= 1, 'eligible-but-absent modules recorded honestly');
  });

  it('(2,3) cites the real readings and their feature-value lineage', async () => {
    const { readings, states } = await withConnection(MODULE, async (tx) => {
      const id = (await tx.query<{ id: string }>(`SELECT id::text FROM snapshot.match_snapshot WHERE fixture_id=$1 AND snapshot_point_code='KICKOFF'`, [fixtureId])).rows[0].id;
      const readings = await tx.query<{ cited: string }>(
        `SELECT cited_module_reading_id::text cited FROM snapshot.snapshot_module_reading WHERE match_snapshot_id=$1 AND fixture_partition_on=$2::date`, [id, partitionOn]);
      const states = await tx.query<{ cited: string }>(
        `SELECT cited_feature_value_id::text cited FROM snapshot.snapshot_feature_state WHERE match_snapshot_id=$1 AND fixture_partition_on=$2::date`, [id, partitionOn]);
      return { readings: readings.rows, states: states.rows };
    });
    assert.equal(readings.length, 4, 'four cited module readings');
    // home_away_split cites 2 win-rate values × 2 teams; readiness cites 1 momentum × 2 teams = up to 6 distinct.
    assert.ok(states.length >= 4, `feature-value lineage captured (${states.length} sealed feature states)`);
  });

  it('(5) the stored checksum is reproducible from the same content', async () => {
    const { storedHex, recomputedHex } = await withConnection(MODULE, async (tx) => {
      const ms = (await tx.query<{ id: string; as_of: Date; checksum: Buffer }>(
        `SELECT id::text, snapshot_as_of as_of, content_checksum checksum FROM snapshot.match_snapshot WHERE fixture_id=$1 AND snapshot_point_code='KICKOFF'`, [fixtureId])).rows[0];
      const spoke = await readSpokeReadings(tx, { teamIds: [teamA, teamB], asOf: ms.as_of, competitionEditionId: editionId, fixtureId });
      const eligible = await readEligibleModules(tx);
      const [vv, cv2, kv] = await Promise.all([
        resolveVersionInForce(tx, 'module.verdict_composition_version', ms.as_of),
        resolveVersionInForce(tx, 'module.consensus_rule_version', ms.as_of),
        resolveVersionInForce(tx, 'module.checksum_algorithm_version', ms.as_of),
      ]);
      const consensus = tallyConsensus(spoke, eligible);
      const completeness = computeCompleteness(spoke, eligible);
      const manifest = buildManifest(spoke, { verdictCompositionVersionId: vv.id, consensusRuleVersionId: cv2.id, checksumAlgorithmVersionId: kv.id });
      const ratioText = completeness.expectedModuleCount === 0 ? '0.000000' : (completeness.engagedModuleCount / completeness.expectedModuleCount).toFixed(6);
      const content = buildContent({
        fixture: { fixtureId, fixturePartitionOn: partitionOn, kickoffAt: KICKOFF, homeTeamId: teamA, awayTeamId: teamB, competitionEditionId: editionId },
        snapshotPointCode: 'KICKOFF', snapshotAsOf: ms.as_of,
        verdictCompositionDesignation: vv.designation, consensusRuleDesignation: cv2.designation, checksumAlgorithmDesignation: kv.designation,
        spoke, manifest, completenessItems: completeness.items,
        verdict: {
          consensusSupportsCount: consensus.supports, consensusContradictsCount: consensus.contradicts,
          consensusNeutralCount: consensus.neutral, consensusInactiveCount: consensus.inactive,
          evidenceCount: consensus.evidenceCount, completenessRatioText: ratioText,
        },
      });
      return { storedHex: ms.checksum.toString('hex'), recomputedHex: contentChecksum(content).toString('hex') };
    });
    assert.equal(recomputedHex, storedHex, 'recomputed checksum matches the stored content_checksum');
  });

  it('(6) a sealed snapshot cannot be mutated (UPDATE and DELETE both raise)', async () => {
    await withConnection(MODULE, async (tx) => {
      await assert.rejects(
        tx.query(`UPDATE snapshot.match_snapshot SET snapshot_point_code='T_MINUS_1D' WHERE fixture_id=$1 AND snapshot_point_code='KICKOFF'`, [fixtureId]),
        /sealed content is immutable/
      );
    });
    await withConnection(MODULE, async (tx) => {
      await assert.rejects(
        tx.query(`DELETE FROM snapshot.match_snapshot WHERE fixture_id=$1 AND snapshot_point_code='KICKOFF'`, [fixtureId]),
        /sealed content is immutable/
      );
    });
  });

  it('(7) a later source value does not contaminate an earlier snapshot', async () => {
    // Write a later reading; the already-sealed KICKOFF snapshot must not cite it,
    // and every sealed feature state must satisfy cited_as_of <= snapshot_as_of.
    await withConnection(FEATURE, async (tx) => {
      const reg = await loadRegistry(tx);
      await writeValues(tx, reg, [{ featureKey: 'team.momentum', teamId: teamA, asOf: LATER, value: fromInt(99), sampleObservationCount: 10, consumed: [] }], LATER);
    });
    await withConnection(MODULE, (tx) => produceReading(tx, 'readiness_tracker', readinessTracker, teamA, ALL_COMPETITIONS_SCOPE, LATER));
    const ok = await withConnection(MODULE, async (tx) => {
      const rows = await tx.query<{ ok: boolean }>(
        `SELECT bool_and(fs.cited_as_of <= ms.snapshot_as_of) ok
           FROM snapshot.match_snapshot ms
           JOIN snapshot.snapshot_feature_state fs ON fs.match_snapshot_id=ms.id AND fs.fixture_partition_on=ms.fixture_partition_on
          WHERE ms.fixture_id=$1`, [fixtureId]);
      return rows.rows[0]?.ok;
    });
    assert.ok(ok !== false, 'no sealed feature state cites a value after its snapshot as-of');
    // Re-sealing at the original now is idempotent — the sealed snapshot is untouched.
    const rerun = await runSnapshotSealing({ fixtureId, now: KICKOFF });
    assert.equal(rerun.sealed, 0, 'no new snapshots on a re-run (idempotent)');
    assert.ok(rerun.skipped > 0, 'existing snapshots are skipped, not mutated');
  });

  it('(8) a newer rule version yields a DISTINCT snapshot, not a mutation', async () => {
    // Proven inside a transaction that is ROLLED BACK, so this test pollutes
    // neither the shared version registry nor the immutable snapshot family.
    await withConnection(MODULE, async (tx) => {
      await tx.query('BEGIN');
      try {
        // A second verdict-composition version with a non-overlapping (past) period.
        const v2 = await tx.query<{ id: string }>(
          `INSERT INTO module.verdict_composition_version (designation, effective_period, rationale)
           VALUES ($1, tstzrange('2020-01-01','2020-02-01'), 'test alt version') RETURNING id::text`, [`test-${TAG}`]);
        const kv = (await tx.query<{ id: string }>(`SELECT id::text FROM module.checksum_algorithm_version WHERE designation='v1'`)).rows[0].id;
        const cv2 = (await tx.query<{ id: string }>(`SELECT id::text FROM module.consensus_rule_version LIMIT 1`)).rows[0].id;
        // Raw-insert a match_snapshot for the SAME fixture+KICKOFF under the new verdict version.
        const inserted = await tx.query<{ id: string }>(
          `INSERT INTO snapshot.match_snapshot
             (fixture_partition_on, fixture_id, snapshot_point_code, snapshot_as_of,
              verdict_composition_version_id, consensus_rule_version_id, content_checksum, checksum_algorithm_version_id)
           VALUES ($1::date,$2::bigint,'KICKOFF',$3::timestamptz,$4::bigint,$5::bigint,'\\x00'::bytea,$6::bigint)
           RETURNING id::text`, [partitionOn, fixtureId, iso(AS_OF), v2.rows[0].id, cv2, kv]);
        assert.equal(inserted.rows.length, 1, 'the new rule version produced a DISTINCT snapshot (no conflict, no mutation)');
        const count = await tx.query<{ n: string }>(`SELECT count(*)::text n FROM snapshot.match_snapshot WHERE fixture_id=$1 AND snapshot_point_code='KICKOFF'`, [fixtureId]);
        assert.equal(Number(count.rows[0].n), 2, 'both versions of the KICKOFF snapshot coexist within the transaction');
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('(10) no directional edge, risk or confidence is ever fabricated', async () => {
    const bad = await withConnection(MODULE, async (tx) => {
      const rows = await tx.query<{ n: string }>(
        `SELECT count(*)::text n FROM snapshot.snapshot_verdict v
           JOIN snapshot.match_snapshot ms ON ms.id=v.match_snapshot_id AND ms.fixture_partition_on=v.fixture_partition_on
          WHERE ms.fixture_id=$1
            AND (v.readiness_edge IS NOT NULL OR v.form_edge IS NOT NULL OR v.travel_edge IS NOT NULL
                 OR v.rest_edge IS NOT NULL OR v.congestion_edge IS NOT NULL OR v.availability_edge IS NOT NULL
                 OR v.risk_score IS NOT NULL OR v.confidence IS NOT NULL OR v.historical_reliability_baseline_id IS NOT NULL)`,
        [fixtureId]);
      return Number(rows.rows[0].n);
    });
    assert.equal(bad, 0, 'every edge/risk/confidence/reliability column is NULL across all sealed verdicts');
  });

  it('a fixture with no readings seals an HONEST empty verdict (never a healthy-looking blank)', async () => {
    const bare = await withConnection(MODULE, async (tx) => {
      const ms = await tx.query<{ id: string }>(`SELECT id::text FROM snapshot.match_snapshot WHERE fixture_id=$1 AND snapshot_point_code='KICKOFF'`, [bareFixtureId]);
      assert.equal(ms.rows.length, 1, 'the bare fixture sealed a KICKOFF snapshot');
      const v = await tx.query<{ evidence: string; inactive: string; supports: string; neutral: string; ratio: string }>(
        `SELECT evidence_count::text evidence, consensus_inactive_count::text inactive,
                consensus_supports_count::text supports, consensus_neutral_count::text neutral,
                completeness_ratio::text ratio
           FROM snapshot.snapshot_verdict WHERE match_snapshot_id=$1 AND fixture_partition_on=$2::date`, [ms.rows[0].id, barePartitionOn]);
      const readings = await tx.query<{ n: string }>(`SELECT count(*)::text n FROM snapshot.snapshot_module_reading WHERE match_snapshot_id=$1 AND fixture_partition_on=$2::date`, [ms.rows[0].id, barePartitionOn]);
      return { ...v.rows[0], readings: Number(readings.rows[0].n) };
    });
    assert.equal(Number(bare.evidence), 0, 'no readings → zero evidence');
    assert.equal(bare.readings, 0, 'no module readings cited');
    assert.equal(Number(bare.supports), 0);
    assert.equal(Number(bare.neutral), 0);
    assert.ok(Number(bare.inactive) > 0, 'every eligible slot recorded inactive, not neutral');
    assert.equal(Number(bare.ratio), 0, 'completeness ratio 0 — nothing engaged');
  });

  it('earlier snapshot points are skipped honestly when no governing rule is in force yet', async () => {
    // On this fresh DB the rules were seeded recently, so a point 7 days before
    // kickoff predates them and CANNOT be sealed — it is skipped, not sealed empty
    // under a fabricated rule. (In production the rules predate every fixture.)
    const early = await withConnection(MODULE, (tx) =>
      tx.query<{ n: string }>(`SELECT count(*)::text n FROM snapshot.match_snapshot WHERE fixture_id=$1 AND snapshot_point_code='T_MINUS_7D'`, [fixtureId]));
    assert.equal(Number(early.rows[0].n), 0, 'no snapshot sealed at a point preceding the governing rules');
  });
});
