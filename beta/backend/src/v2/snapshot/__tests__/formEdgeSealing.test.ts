// S-8 — sealing the governed form edge (composition version 1.2.0). DB-gated.
//
// Proves the end-to-end path: SEALED home.home_form + SEALED away.away_form →
// home − away → snapshot_verdict.form_edge, read ONLY from sealed snapshot data,
// under composition 1.2.0 — alongside rest_edge, each independent (never
// combined). Covers: both edges populate under 1.2.0; the form edge is attributed
// by (featureKey, subject team), not citation order; a 1.1.0-era snapshot keeps
// rest_edge but form_edge NULL and is untouched; idempotency; the checksum depends
// on form_edge; and ONLY rest_edge + form_edge are populated.

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
import { formGapAccuracy } from '../../module/calculators/formGapAccuracy';
import { assembleFixtureReading } from '../../module/pipeline';
import { loadModuleRegistry, resolveModuleVersion } from '../../module/registry/load';
import { readConsumedFeatures, consumedKey } from '../../module/read/consumedFeatures';
import { writeReading } from '../../module/write/readings';
import { homeInputKeys, awayInputKeys, type ConsumedFeature } from '../../module/types';

import { readSpokeReadings, readEligibleModules, resolveVersionInForce } from '../read/selection';
import { runSnapshotSealing } from '../driver';
import { buildContent } from '../seal';
import { tallyConsensus, computeCompleteness, buildManifest, computeRestEdge, computeFormEdge } from '../verdict';
import { contentChecksum } from '../canonical';

import { testDatabaseReady } from '../../db/testSupport';
const hasDatabase = testDatabaseReady();
const REST = 'team.rest_advantage';
const HOME_FORM = 'team.home_form';
const AWAY_FORM = 'team.away_form';

describe('S-8 form edge sealing over a real database', { skip: !hasDatabase }, () => {
  const INGESTION = 'pt_pipeline_ingestion' as const;
  const FEATURE = 'pt_pipeline_feature' as const;
  const MODULE = 'pt_pipeline_module' as const;

  const KICKOFF = new Date(Math.floor((Date.now() - 5_000) / 1000) * 1000); // <= now, after the 1.2.0 cutover
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const iso = (d: Date) => d.toISOString();
  const partitionOn = day(KICKOFF);
  let seq = 0;
  const nextTag = () => `${Date.now() % 1_000_000}-${++seq}`;

  interface Sealed {
    fixtureId: string; editionId: string; homeTeamId: string; awayTeamId: string;
    snapshotId: string; restEdge: string | null; formEdge: string | null; designation: string;
  }

  // Fresh fixture with BOTH FIXTURE readings' inputs: rest (home/away) and venue
  // form (home.home_form, away.away_form) plus distractor venue-form values on the
  // wrong side, which must be ignored. Produces both FIXTURE readings, seals.
  async function sealBoth(
    homeRest: number, awayRest: number, homeForm: number, awayForm: number,
    opts: { formSample?: number } = {}
  ): Promise<Sealed> {
    const tag = nextTag();
    let editionId = '', homeTeamId = '', awayTeamId = '', fixtureId = '';

    await withConnection(INGESTION, async (tx) => {
      const comp = await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
         VALUES ('SPORTSAPI_API',$1,'S8F League',$2,'GB') RETURNING id::text`, [`S8F-C-${tag}`, `s8f-c-${tag}`]);
      const ed = await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1,$2,'S8F', daterange('2026-01-01','2029-01-01')) RETURNING id::text`, [comp.rows[0].id, `S8F-S-${tag}`]);
      editionId = ed.rows[0].id;
      const team = async (s: string) => (await tx.query<{ id: string }>(
        `INSERT INTO football.team (provider_code, provider_external_id, name, slug) VALUES ('SPORTSAPI_API',$1,$2,$3) RETURNING id::text`,
        [`S8F-T${s}-${tag}`, `S8F ${s}`, `s8f-${s}-${tag}`])).rows[0].id;
      homeTeamId = await team('H'); awayTeamId = await team('A');
      const fx = await tx.query<{ id: string }>(
        `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
           is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         VALUES ('SPORTSAPI_API',$1,$2::date,$3,false,$4,$5,$6,'SCHEDULED') RETURNING id::text`,
        [`S8F-F-${tag}`, partitionOn, editionId, homeTeamId, awayTeamId, iso(KICKOFF)]);
      fixtureId = fx.rows[0].id;
    });

    await withConnection(FEATURE, async (tx) => {
      const reg = await loadRegistry(tx);
      const fs = opts.formSample ?? 8;
      await writeValues(tx, reg, [
        { featureKey: REST, teamId: homeTeamId, asOf: KICKOFF, value: fromInt(homeRest), sampleObservationCount: 1, consumed: [] },
        { featureKey: REST, teamId: awayTeamId, asOf: KICKOFF, value: fromInt(awayRest), sampleObservationCount: 1, consumed: [] },
        { featureKey: HOME_FORM, teamId: homeTeamId, asOf: KICKOFF, value: fromInt(homeForm), sampleObservationCount: fs, consumed: [] },
        { featureKey: AWAY_FORM, teamId: awayTeamId, asOf: KICKOFF, value: fromInt(awayForm), sampleObservationCount: fs, consumed: [] },
        // Distractors on the wrong side — must be ignored by computeFormEdge.
        { featureKey: AWAY_FORM, teamId: homeTeamId, asOf: KICKOFF, value: fromInt(99), sampleObservationCount: fs, consumed: [] },
        { featureKey: HOME_FORM, teamId: awayTeamId, asOf: KICKOFF, value: fromInt(99), sampleObservationCount: fs, consumed: [] },
      ], KICKOFF);
    });

    await withConnection(MODULE, async (tx) => {
      const reg = await loadModuleRegistry(tx);
      for (const calc of [restAdvantage, formGapAccuracy]) {
        const def = reg.definitionsByKey.get(calc.moduleKey)!;
        const version = await resolveModuleVersion(tx, def.moduleDefinitionId, KICKOFF);
        const homeKeys = homeInputKeys(calc); const awayKeys = awayInputKeys(calc);
        const allKeys = [...new Set([...homeKeys, ...awayKeys])];
        const consumed = await readConsumedFeatures(tx, allKeys, [homeTeamId, awayTeamId], KICKOFF, ALL_COMPETITIONS_SCOPE);
        const homeInputs = new Map<string, ConsumedFeature>(); const awayInputs = new Map<string, ConsumedFeature>();
        for (const k of homeKeys) { const v = consumed.get(consumedKey(k, homeTeamId)); if (v) homeInputs.set(k, v); }
        for (const k of awayKeys) { const v = consumed.get(consumedKey(k, awayTeamId)); if (v) awayInputs.set(k, v); }
        await writeReading(tx, {
          ...assembleFixtureReading({ calculator: calc, definition: def, version: version!, asOf: KICKOFF,
            scope: ALL_COMPETITIONS_SCOPE, fixtureId, fixturePartitionOn: partitionOn, homeInputs, awayInputs }),
          calculatedAt: KICKOFF,
        });
      }
    });

    await runSnapshotSealing({ fixtureId, now: KICKOFF });

    const row = await withConnection(MODULE, (tx) => tx.query<{ id: string; rest: string | null; form: string | null; d: string }>(
      `SELECT ms.id::text id, v.rest_edge::text rest, v.form_edge::text form, vv.designation d
         FROM snapshot.match_snapshot ms
         JOIN snapshot.snapshot_verdict v ON v.match_snapshot_id=ms.id AND v.fixture_partition_on=ms.fixture_partition_on
         JOIN module.verdict_composition_version vv ON vv.id=ms.verdict_composition_version_id
        WHERE ms.fixture_id=$1 AND ms.snapshot_point_code='KICKOFF'`, [fixtureId]));
    return {
      fixtureId, editionId, homeTeamId, awayTeamId, snapshotId: row.rows[0].id,
      restEdge: row.rows[0].rest, formEdge: row.rows[0].form, designation: row.rows[0].d,
    };
  }

  after(async () => { await closeAllPools(); });

  it('(1) a 1.2.0 snapshot gets BOTH rest_edge and form_edge', async () => {
    const s = await sealBoth(6, 2, 7, 3); // rest = 4, form = 4
    assert.equal(s.designation, '1.2.0', 'sealed under the composition version that governs form_edge');
    assert.equal(Number(s.restEdge), 4, 'rest_edge = 6 − 2');
    assert.equal(Number(s.formEdge), 4, 'form_edge = 7 − 3');
  });

  it('(2) form_edge is computed from the correct home/away venue-form values, not citation order', async () => {
    const s = await sealBoth(3, 3, 9, 1); // rest = 0, form = 8 (distractors are 99)
    assert.equal(Number(s.formEdge), 8, 'home.home_form(9) − away.away_form(1); distractors ignored');
    // Confirm the sealed feature-state values behind the edge are the right sides.
    const sides = await withConnection(MODULE, (tx) => tx.query<{ key: string; team: string; val: string }>(
      `SELECT d.feature_key key, fv.subject_team_id::text team, fv.value::text val
         FROM snapshot.snapshot_feature_state sfs
         JOIN feature.feature_value fv ON fv.id=sfs.cited_feature_value_id AND fv.as_of=sfs.cited_as_of
         JOIN feature.feature_definition d ON d.id=fv.feature_definition_id
        WHERE sfs.match_snapshot_id=$1 AND d.feature_key = ANY($2::text[])`, [s.snapshotId, [HOME_FORM, AWAY_FORM]]));
    const used = sides.rows.filter((r) => (r.key === HOME_FORM && r.team === s.homeTeamId) || (r.key === AWAY_FORM && r.team === s.awayTeamId));
    assert.ok(used.some((r) => r.key === HOME_FORM && Number(r.val) === 9), 'home.home_form 9 sealed');
    assert.ok(used.some((r) => r.key === AWAY_FORM && Number(r.val) === 1), 'away.away_form 1 sealed');
  });

  it('(3) negative and zero edges seal correctly', async () => {
    const neg = await sealBoth(3, 3, 2, 6);
    assert.equal(Number(neg.formEdge), -4, 'away venue form stronger → negative');
    const zero = await sealBoth(3, 3, 5, 5);
    assert.equal(Number(zero.formEdge), 0, 'equal venue form → 0 (real value, not NULL)');
  });

  it('(8) ONLY rest_edge and form_edge are populated; every other graded column is NULL', async () => {
    const s = await sealBoth(6, 2, 7, 3);
    const clean = await withConnection(MODULE, (tx) => tx.query<{ ok: boolean }>(
      `SELECT (readiness_edge IS NULL AND travel_edge IS NULL AND congestion_edge IS NULL
               AND availability_edge IS NULL AND risk_score IS NULL AND confidence IS NULL
               AND historical_reliability_baseline_id IS NULL) ok
         FROM snapshot.snapshot_verdict WHERE match_snapshot_id=$1`, [s.snapshotId]));
    assert.equal(clean.rows[0].ok, true, 'no other edge/risk/confidence/reliability fabricated');
    assert.ok(s.restEdge !== null && s.formEdge !== null, 'both governed edges present');
  });

  it('(3-repeat) a pre-existing 1.1.0 snapshot keeps rest_edge but form_edge NULL, and is not mutated', async () => {
    const s = await sealBoth(5, 1, 8, 2); // real 1.2.0 snapshot: rest 4, form 6
    await withConnection(MODULE, async (tx) => {
      await tx.query('BEGIN');
      try {
        const v110 = (await tx.query<{ id: string }>(`SELECT id::text FROM module.verdict_composition_version WHERE designation='1.1.0'`)).rows[0].id;
        const kv = (await tx.query<{ id: string }>(`SELECT id::text FROM module.checksum_algorithm_version WHERE designation='v1'`)).rows[0].id;
        const cv = (await tx.query<{ id: string }>(`SELECT id::text FROM module.consensus_rule_version LIMIT 1`)).rows[0].id;
        // Forge a 1.1.0-era snapshot of the SAME fixture: rest_edge set, form_edge NULL
        // (1.1.0 does not govern form_edge). Rolled back — pollutes nothing.
        const forged = await tx.query<{ id: string }>(
          `INSERT INTO snapshot.match_snapshot
             (fixture_partition_on, fixture_id, snapshot_point_code, snapshot_as_of,
              verdict_composition_version_id, consensus_rule_version_id, content_checksum, checksum_algorithm_version_id)
           VALUES ($1::date,$2::bigint,'KICKOFF',$3::timestamptz,$4::bigint,$5::bigint,'\\x02'::bytea,$6::bigint)
           RETURNING id::text`, [partitionOn, s.fixtureId, iso(KICKOFF), v110, cv, kv]);
        await tx.query(
          `INSERT INTO snapshot.snapshot_verdict
             (fixture_partition_on, match_snapshot_id, verdict_composition_version_id,
              rest_edge, form_edge, evidence_count, consensus_supports_count, consensus_contradicts_count,
              consensus_neutral_count, consensus_inactive_count, completeness_ratio)
           VALUES ($1::date,$2::bigint,$3::bigint, 4, NULL, 0,0,0,0,0, 0)`, [partitionOn, forged.rows[0].id, v110]);
        const both = await tx.query<{ d: string; rest: string | null; form: string | null }>(
          `SELECT vv.designation d, v.rest_edge::text rest, v.form_edge::text form
             FROM snapshot.match_snapshot ms
             JOIN snapshot.snapshot_verdict v ON v.match_snapshot_id=ms.id
             JOIN module.verdict_composition_version vv ON vv.id=ms.verdict_composition_version_id
            WHERE ms.fixture_id=$1 AND ms.snapshot_point_code='KICKOFF' ORDER BY vv.designation`, [s.fixtureId]);
        const byVer = new Map(both.rows.map((r) => [r.d, r]));
        assert.equal(byVer.get('1.1.0')!.form, null, '1.1.0 verdict has form_edge NULL (ungoverned there)');
        assert.equal(Number(byVer.get('1.1.0')!.rest), 4, '1.1.0 verdict keeps rest_edge');
        assert.equal(Number(byVer.get('1.2.0')!.form), 6, '1.2.0 verdict carries form_edge');
        assert.equal(Number(byVer.get('1.2.0')!.rest), 4, '1.2.0 verdict also carries rest_edge');
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  });

  it('(4,5) existing snapshot is immutable; re-sealing is idempotent and does not mutate the verdict', async () => {
    const s = await sealBoth(6, 1, 9, 4); // rest 5, form 5
    const rerun = await runSnapshotSealing({ fixtureId: s.fixtureId, now: KICKOFF });
    assert.equal(rerun.sealed, 0, 're-running seals nothing new');
    assert.ok(rerun.skipped > 0, 'the existing snapshot is skipped, not duplicated');
    const after = await withConnection(MODULE, (tx) => tx.query<{ rest: string | null; form: string | null; n: string }>(
      `SELECT v.rest_edge::text rest, v.form_edge::text form,
              (SELECT count(*)::text FROM snapshot.match_snapshot WHERE fixture_id=$1 AND snapshot_point_code='KICKOFF') n
         FROM snapshot.snapshot_verdict v WHERE v.match_snapshot_id=$2`, [s.fixtureId, s.snapshotId]));
    assert.equal(Number(after.rows[0].n), 1, 'still exactly one KICKOFF snapshot');
    assert.equal(Number(after.rows[0].rest), 5);
    assert.equal(Number(after.rows[0].form), 5, 'form_edge unchanged after re-run');
    // Immutability of the sealed family.
    await withConnection(MODULE, async (tx) => {
      await assert.rejects(
        tx.query(`UPDATE snapshot.snapshot_verdict SET form_edge=form_edge WHERE match_snapshot_id=$1`, [s.snapshotId]),
        /sealed content is immutable/
      );
    });
  });

  it('(6,7) the content checksum depends on form_edge (part of the hashed verdict content)', async () => {
    const s = await sealBoth(6, 2, 7, 3); // form_edge = 4
    const { stored, withForm, withoutForm } = await withConnection(MODULE, async (tx) => {
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
      const sides = { homeTeamId: s.homeTeamId, awayTeamId: s.awayTeamId };
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
        restEdge: computeRestEdge(spoke, sides),
      };
      const form = computeFormEdge(spoke, sides);
      assert.ok(form !== null, 'the reconstructed form edge is present');
      const withForm = contentChecksum(buildContent({ ...base, verdict: { ...verdictBase, formEdge: form } }));
      const withoutForm = contentChecksum(buildContent({ ...base, verdict: { ...verdictBase, formEdge: null } }));
      return { stored: ms.checksum.toString('hex'), withForm: withForm.toString('hex'), withoutForm: withoutForm.toString('hex') };
    });
    assert.equal(withForm, stored, 'the stored checksum reproduces from content that INCLUDES form_edge');
    assert.notEqual(withoutForm, stored, 'omitting form_edge produces a DIFFERENT checksum — form_edge is hashed content');
  });
});
