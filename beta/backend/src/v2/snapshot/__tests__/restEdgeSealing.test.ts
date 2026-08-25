// S-8 — sealing the governed rest edge (composition version 1.1.0). DB-gated.
//
// Proves the end-to-end path: SEALED home rest + SEALED away rest → home − away
// → snapshot_verdict.rest_edge, read ONLY from sealed snapshot data, under the
// 1.1.0 composition version. Covers sign, zero-as-real, missing → NULL,
// below-threshold-still-calculable, HOME/AWAY lineage, only-rest_edge-populated,
// the version manifest, the checksum's dependence on rest_edge, and 1.0.0
// coexistence (old snapshots untouched).

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { loadRegistry } from '../../feature/registry/load';
import { writeValues } from '../../feature/write/values';
import { fromInt } from '../../feature/write/scale';
import { ALL_COMPETITIONS_SCOPE } from '../../feature/calculators/types';
import { restAdvantage } from '../../module/calculators/restAdvantage';
import { assembleFixtureReading } from '../../module/pipeline';
import { loadModuleRegistry, resolveModuleVersion } from '../../module/registry/load';
import { readConsumedFeatures, consumedKey } from '../../module/read/consumedFeatures';
import { writeReading } from '../../module/write/readings';
import type { ConsumedFeature } from '../../module/types';

import { readSpokeReadings, readEligibleModules, resolveVersionInForce } from '../read/selection';
import { runSnapshotSealing } from '../driver';
import { buildContent } from '../seal';
import { tallyConsensus, computeCompleteness, buildManifest, computeRestEdge, computeFormEdge } from '../verdict';
import { contentChecksum } from '../canonical';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);

describe('S-8 rest edge sealing over a real database', { skip: !hasDatabase }, () => {
  const INGESTION = 'pt_pipeline_ingestion' as const;
  const FEATURE = 'pt_pipeline_feature' as const;
  const MODULE = 'pt_pipeline_module' as const;

  const KICKOFF = new Date(Math.floor((Date.now() - 5_000) / 1000) * 1000); // sealable (<= now, after 1.1.0 cutover)
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const iso = (d: Date) => d.toISOString();
  const partitionOn = day(KICKOFF);

  // Distinct integer tag per fixture so provider keys never collide across cases.
  let seq = 0;
  const nextTag = () => `${Date.now() % 1_000_000}-${++seq}`;

  interface Sealed {
    fixtureId: string;
    editionId: string;
    homeTeamId: string;
    awayTeamId: string;
    snapshotId: string;
    restEdge: string | null;
    designation: string;
  }

  // Creates a fresh comp/edition/teams/fixture, writes each side's rest value
  // (undefined omits that side), produces the FIXTURE rest reading and any TEAM
  // readings, seals, and returns the sealed rest_edge + composition designation.
  async function sealRest(
    homeRest: number | undefined,
    awayRest: number | undefined,
    opts: { homeSample?: number; awaySample?: number } = {}
  ): Promise<Sealed> {
    const tag = nextTag();
    let editionId = '', homeTeamId = '', awayTeamId = '', fixtureId = '';

    await withConnection(INGESTION, async (tx) => {
      const comp = await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
         VALUES ('SPORTSAPI_API',$1,'S8 League',$2,'GB') RETURNING id::text`, [`S8-C-${tag}`, `s8-c-${tag}`]);
      const ed = await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1,$2,'S8', daterange('2026-01-01','2029-01-01')) RETURNING id::text`, [comp.rows[0].id, `S8-S-${tag}`]);
      editionId = ed.rows[0].id;
      const team = async (s: string) => (await tx.query<{ id: string }>(
        `INSERT INTO football.team (provider_code, provider_external_id, name, slug) VALUES ('SPORTSAPI_API',$1,$2,$3) RETURNING id::text`,
        [`S8-T${s}-${tag}`, `S8 ${s}`, `s8-${s}-${tag}`])).rows[0].id;
      homeTeamId = await team('H'); awayTeamId = await team('A');
      const fx = await tx.query<{ id: string }>(
        `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
           is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         VALUES ('SPORTSAPI_API',$1,$2::date,$3,false,$4,$5,$6,'SCHEDULED') RETURNING id::text`,
        [`S8-F-${tag}`, partitionOn, editionId, homeTeamId, awayTeamId, iso(KICKOFF)]);
      fixtureId = fx.rows[0].id;
    });

    await withConnection(FEATURE, async (tx) => {
      const reg = await loadRegistry(tx);
      const vals = [];
      if (homeRest !== undefined) vals.push({ featureKey: 'team.rest_advantage', teamId: homeTeamId, asOf: KICKOFF, value: fromInt(homeRest), sampleObservationCount: opts.homeSample ?? 1, consumed: [] });
      if (awayRest !== undefined) vals.push({ featureKey: 'team.rest_advantage', teamId: awayTeamId, asOf: KICKOFF, value: fromInt(awayRest), sampleObservationCount: opts.awaySample ?? 1, consumed: [] });
      if (vals.length) await writeValues(tx, reg, vals, KICKOFF);
    });

    await withConnection(MODULE, async (tx) => {
      const reg = await loadModuleRegistry(tx);
      const def = reg.definitionsByKey.get('rest_advantage')!;
      const version = await resolveModuleVersion(tx, def.moduleDefinitionId, KICKOFF);
      const consumed = await readConsumedFeatures(tx, restAdvantage.inputFeatureKeys, [homeTeamId, awayTeamId], KICKOFF, ALL_COMPETITIONS_SCOPE);
      const homeInputs = new Map<string, ConsumedFeature>(); const awayInputs = new Map<string, ConsumedFeature>();
      for (const k of restAdvantage.inputFeatureKeys) {
        const h = consumed.get(consumedKey(k, homeTeamId)); const a = consumed.get(consumedKey(k, awayTeamId));
        if (h) homeInputs.set(k, h); if (a) awayInputs.set(k, a);
      }
      await writeReading(tx, {
        ...assembleFixtureReading({ calculator: restAdvantage, definition: def, version: version!, asOf: KICKOFF,
          scope: ALL_COMPETITIONS_SCOPE, fixtureId, fixturePartitionOn: partitionOn, homeInputs, awayInputs }),
        calculatedAt: KICKOFF,
      });
    });

    await runSnapshotSealing({ fixtureId, now: KICKOFF });

    const row = await withConnection(MODULE, (tx) => tx.query<{ id: string; rest: string | null; d: string }>(
      `SELECT ms.id::text id, v.rest_edge::text rest, vv.designation d
         FROM snapshot.match_snapshot ms
         JOIN snapshot.snapshot_verdict v ON v.match_snapshot_id=ms.id AND v.fixture_partition_on=ms.fixture_partition_on
         JOIN module.verdict_composition_version vv ON vv.id=ms.verdict_composition_version_id
        WHERE ms.fixture_id=$1 AND ms.snapshot_point_code='KICKOFF'`, [fixtureId]));
    return { fixtureId, editionId, homeTeamId, awayTeamId, snapshotId: row.rows[0].id, restEdge: row.rows[0].rest, designation: row.rows[0].d };
  }

  after(async () => { await closeAllPools(); });

  it('(1) home has more rest → positive edge, sealed under 1.1.0', async () => {
    const s = await sealRest(6, 2);
    assert.equal(s.designation, '1.2.0', 'sealed under the current composition version, which governs rest_edge');
    assert.equal(Number(s.restEdge), 4, 'rest_edge = 6 − 2');
  });

  it('(2) away has more rest → negative edge', async () => {
    const s = await sealRest(2, 6);
    assert.equal(Number(s.restEdge), -4, 'rest_edge = 2 − 6');
  });

  it('(3,4) equal rest → zero edge; zero is a real value', async () => {
    const s = await sealRest(3, 3);
    assert.equal(Number(s.restEdge), 0, 'rest_edge = 3 − 3');
    const z = await sealRest(0, 3);
    assert.equal(Number(z.restEdge), -3, 'home 0 is a real rest value: 0 − 3');
  });

  it('(5,6) a missing required side → rest_edge NULL (never substituted)', async () => {
    const missingAway = await sealRest(5, undefined);
    assert.equal(missingAway.restEdge, null, 'no away rest value → rest reading INACTIVE, not sealed → rest_edge NULL');
    const missingHome = await sealRest(undefined, 5);
    assert.equal(missingHome.restEdge, null, 'no home rest value → rest_edge NULL');
  });

  it('(7,8) below-threshold numeric values still yield an edge; the caveat is recorded in completeness', async () => {
    // Home rest sample below the feature threshold (rest_advantage minimum = 1).
    const s = await sealRest(7, 2, { homeSample: 0 });
    assert.equal(Number(s.restEdge), 5, 'rest_edge = 7 − 2 even though a side is below threshold');
    const below = await withConnection(MODULE, (tx) => tx.query<{ n: string }>(
      `SELECT count(*)::text n FROM snapshot.snapshot_completeness c
         JOIN snapshot.snapshot_completeness_item i ON i.snapshot_completeness_id=c.id AND i.fixture_partition_on=c.fixture_partition_on
        WHERE c.match_snapshot_id=$1 AND i.absence_kind='FEATURE_BELOW_THRESHOLD'`, [s.snapshotId]));
    assert.ok(Number(below.rows[0].n) >= 1, 'the below-threshold condition is recorded by completeness, not by nulling the value');
  });

  it('(9) HOME/AWAY come from each value’s own sealed subject team (lineage), not order', async () => {
    const s = await sealRest(9, 1);
    // Confirm the two sealed feature-state values are the home and away teams' own values.
    const sides = await withConnection(MODULE, (tx) => tx.query<{ team: string; val: string }>(
      `SELECT fv.subject_team_id::text team, fv.value::text val
         FROM snapshot.snapshot_feature_state sfs
         JOIN feature.feature_value fv ON fv.id=sfs.cited_feature_value_id AND fv.as_of=sfs.cited_as_of
         JOIN feature.feature_definition d ON d.id=fv.feature_definition_id
        WHERE sfs.match_snapshot_id=$1 AND d.feature_key='team.rest_advantage'`, [s.snapshotId]));
    const byTeam = new Map(sides.rows.map((r) => [r.team, Number(r.val)]));
    assert.equal(byTeam.get(s.homeTeamId), 9, 'home value sealed');
    assert.equal(byTeam.get(s.awayTeamId), 1, 'away value sealed');
    assert.equal(Number(s.restEdge), 8, 'edge follows subject-team attribution: 9 − 1');
  });

  it('(10) ONLY rest_edge is populated; every other edge/risk/confidence/reliability is NULL', async () => {
    const s = await sealRest(4, 1);
    const clean = await withConnection(MODULE, (tx) => tx.query<{ ok: boolean }>(
      `SELECT (readiness_edge IS NULL AND form_edge IS NULL AND travel_edge IS NULL
               AND congestion_edge IS NULL AND availability_edge IS NULL
               AND risk_score IS NULL AND confidence IS NULL AND historical_reliability_baseline_id IS NULL) ok
         FROM snapshot.snapshot_verdict WHERE match_snapshot_id=$1`, [s.snapshotId]));
    assert.equal(clean.rows[0].ok, true, 'no non-rest edge, risk, confidence or reliability was fabricated');
    assert.equal(Number(s.restEdge), 3);
  });

  it('(11) the sealed snapshot carries its composition version in its manifest', async () => {
    const s = await sealRest(5, 5);
    const inManifest = await withConnection(MODULE, (tx) => tx.query<{ n: string }>(
      `SELECT count(*)::text n
         FROM snapshot.snapshot_version_component svc
         JOIN module.verdict_composition_version vv ON vv.id=svc.component_version_id
        WHERE svc.match_snapshot_id=$1 AND svc.component_kind='VERDICT_COMPOSITION_VERSION' AND vv.designation=$2`,
      [s.snapshotId, s.designation]));
    assert.equal(Number(inManifest.rows[0].n), 1, 'the version manifest records the snapshot’s verdict_composition_version');
  });

  it('(12) the content checksum depends on rest_edge (it is part of the hashed content)', async () => {
    const s = await sealRest(6, 2); // rest_edge = 4
    const { stored, withEdge, withoutEdge } = await withConnection(MODULE, async (tx) => {
      const ms = (await tx.query<{ as_of: Date; checksum: Buffer }>(
        `SELECT snapshot_as_of as_of, content_checksum checksum FROM snapshot.match_snapshot WHERE id=$1`, [s.snapshotId])).rows[0];
      const spoke = await readSpokeReadings(tx, { teamIds: [s.homeTeamId, s.awayTeamId], asOf: ms.as_of, competitionEditionId: s.editionId, fixtureId: s.fixtureId });
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
      const base = {
        fixture: { fixtureId: s.fixtureId, fixturePartitionOn: partitionOn, kickoffAt: KICKOFF, homeTeamId: s.homeTeamId, awayTeamId: s.awayTeamId, competitionEditionId: s.editionId },
        snapshotPointCode: 'KICKOFF', snapshotAsOf: ms.as_of,
        verdictCompositionDesignation: vv.designation, consensusRuleDesignation: cv2.designation, checksumAlgorithmDesignation: kv.designation,
        spoke, manifest, completenessItems: completeness.items,
      } as const;
      const verdictBase = {
        consensusSupportsCount: consensus.supports, consensusContradictsCount: consensus.contradicts,
        consensusNeutralCount: consensus.neutral, consensusInactiveCount: consensus.inactive,
        evidenceCount: consensus.evidenceCount, completenessRatioText: ratioText,
        // This fixture has no form reading → form_edge is null under any version.
        formEdge: computeFormEdge(spoke, { homeTeamId: s.homeTeamId, awayTeamId: s.awayTeamId }),
      };
      // The governed edge at the sealed feature scale (never hardcode a scale here).
      const edge = computeRestEdge(spoke, { homeTeamId: s.homeTeamId, awayTeamId: s.awayTeamId });
      assert.ok(edge !== null, 'the reconstructed rest edge is present for this fixture');
      const withEdge = contentChecksum(buildContent({ ...base, verdict: { ...verdictBase, restEdge: edge } }));
      const withoutEdge = contentChecksum(buildContent({ ...base, verdict: { ...verdictBase, restEdge: null } }));
      return { stored: ms.checksum.toString('hex'), withEdge: withEdge.toString('hex'), withoutEdge: withoutEdge.toString('hex') };
    });
    assert.equal(withEdge, stored, 'the stored checksum reproduces from content that INCLUDES rest_edge');
    assert.notEqual(withoutEdge, stored, 'omitting rest_edge produces a DIFFERENT checksum — rest_edge is hashed content');
  });

  it('(13) a pre-existing 1.0.0 snapshot is not mutated and coexists with the current one', async () => {
    // Seal a real current-version snapshot for a fixture, then (in a rolled-back tx)
    // forge a 1.0.0-era snapshot of the SAME fixture with rest_edge NULL and prove
    // they coexist and the 1.0.0 row keeps rest_edge NULL — S-8 never rewrites it.
    const s = await sealRest(5, 1); // current version, rest_edge = 4
    await withConnection(MODULE, async (tx) => {
      await tx.query('BEGIN');
      try {
        const v100 = (await tx.query<{ id: string }>(
          `SELECT id::text FROM module.verdict_composition_version WHERE designation='1.0.0'`)).rows[0].id;
        const kv = (await tx.query<{ id: string }>(`SELECT id::text FROM module.checksum_algorithm_version WHERE designation='v1'`)).rows[0].id;
        const cv = (await tx.query<{ id: string }>(`SELECT id::text FROM module.consensus_rule_version LIMIT 1`)).rows[0].id;
        const forged = await tx.query<{ id: string }>(
          `INSERT INTO snapshot.match_snapshot
             (fixture_partition_on, fixture_id, snapshot_point_code, snapshot_as_of,
              verdict_composition_version_id, consensus_rule_version_id, content_checksum, checksum_algorithm_version_id)
           VALUES ($1::date,$2::bigint,'KICKOFF',$3::timestamptz,$4::bigint,$5::bigint,'\\x01'::bytea,$6::bigint)
           RETURNING id::text`, [partitionOn, s.fixtureId, iso(KICKOFF), v100, cv, kv]);
        await tx.query(
          `INSERT INTO snapshot.snapshot_verdict
             (fixture_partition_on, match_snapshot_id, verdict_composition_version_id,
              rest_edge, evidence_count, consensus_supports_count, consensus_contradicts_count,
              consensus_neutral_count, consensus_inactive_count, completeness_ratio)
           VALUES ($1::date,$2::bigint,$3::bigint, NULL, 0,0,0,0,0, 0)`, [partitionOn, forged.rows[0].id, v100]);
        const both = await tx.query<{ designation: string; rest: string | null }>(
          `SELECT vv.designation, v.rest_edge::text rest
             FROM snapshot.match_snapshot ms
             JOIN snapshot.snapshot_verdict v ON v.match_snapshot_id=ms.id
             JOIN module.verdict_composition_version vv ON vv.id=ms.verdict_composition_version_id
            WHERE ms.fixture_id=$1 AND ms.snapshot_point_code='KICKOFF' ORDER BY vv.designation`, [s.fixtureId]);
        assert.deepEqual(both.rows.map((r) => r.designation).sort(), ['1.0.0', s.designation].sort(), 'both versions coexist for the fixture');
        const byVer = new Map(both.rows.map((r) => [r.designation, r.rest]));
        assert.equal(byVer.get('1.0.0'), null, 'the 1.0.0 verdict keeps rest_edge NULL — untouched');
        assert.equal(Number(byVer.get(s.designation)), 4, 'the current-version verdict carries the computed rest_edge');
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('(14) sealing is idempotent — a re-run seals nothing new and does not mutate the verdict', async () => {
    const s = await sealRest(6, 1); // rest_edge = 5
    const rerun = await runSnapshotSealing({ fixtureId: s.fixtureId, now: KICKOFF });
    assert.equal(rerun.sealed, 0, 're-running seals nothing new');
    assert.ok(rerun.skipped > 0, 'the existing snapshot is skipped, not duplicated');
    const after = await withConnection(MODULE, (tx) => tx.query<{ rest: string | null; n: string }>(
      `SELECT v.rest_edge::text rest,
              (SELECT count(*)::text FROM snapshot.match_snapshot WHERE fixture_id=$1 AND snapshot_point_code='KICKOFF') n
         FROM snapshot.snapshot_verdict v WHERE v.match_snapshot_id=$2`, [s.fixtureId, s.snapshotId]));
    assert.equal(Number(after.rows[0].n), 1, 'still exactly one KICKOFF snapshot');
    assert.equal(Number(after.rows[0].rest), 5, 'rest_edge unchanged after re-run');
  });
});
