// S-9B — outcome/substrate accrual over a real database. DB-gated.
//
// Proves the ratified accrual substrate end to end: a KICKOFF snapshot of a
// COMPLETED, governed-TRACKED fixture with a prevailing result receives an
// immutable, additive, revision-aware MATCH_RESULT outcome link — with the
// derivation version pinned — and nothing else (no calibration/confidence/risk).

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { runOutcomeAccrual } from '../driver';

import { testDatabaseReady } from '../../db/testSupport';
const hasDatabase = testDatabaseReady();

describe('S-9B outcome accrual over a real database', { skip: !hasDatabase }, () => {
  const INGESTION = 'pt_pipeline_ingestion' as const;
  const ADMIN = 'pt_platform_admin' as const;
  const MODULE = 'pt_pipeline_module' as const;
  const CAL = 'pt_pipeline_calibration' as const;

  const KICKOFF = new Date(Math.floor((Date.now() - 2 * 3_600_000) / 1000) * 1000); // 2h ago, sealable
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const iso = (d: Date) => d.toISOString();
  const partitionOn = day(KICKOFF);
  let seq = 0;
  const tag = () => `${Date.now() % 1_000_000}-${++seq}`;

  interface Fx { fixtureId: string; editionId: string; resultId: string; matchSnapshotId: string; }

  // Build a fixture with a result and one sealed snapshot. `tracked` governs whether
  // its edition is in the governed TRACKED universe; `lifecycle` and `point` vary per test.
  async function setup(opts: {
    home: number; away: number; tracked?: boolean; lifecycle?: string; point?: string;
  }): Promise<Fx> {
    const t = tag();
    const tracked = opts.tracked ?? true;
    const lifecycle = opts.lifecycle ?? 'COMPLETED';
    const point = opts.point ?? 'KICKOFF';
    let compId = '', editionId = '', homeId = '', awayId = '', fixtureId = '', resultId = '';

    // 1. Create the fixture in an OPEN lifecycle (SCHEDULED) so its pre-match
    //    snapshot can be sealed — mirroring reality: evidence is sealed before kickoff.
    await withConnection(INGESTION, async (tx) => {
      compId = (await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
         VALUES ('SPORTSAPI_API',$1,'S9B League',$2,'GB') RETURNING id::text`, [`S9B-C-${t}`, `s9b-c-${t}`])).rows[0].id;
      editionId = (await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1,$2,'S9B', daterange('2026-01-01','2029-01-01')) RETURNING id::text`, [compId, `S9B-S-${t}`])).rows[0].id;
      const team = async (s: string) => (await tx.query<{ id: string }>(
        `INSERT INTO football.team (provider_code, provider_external_id, name, slug) VALUES ('SPORTSAPI_API',$1,$2,$3) RETURNING id::text`,
        [`S9B-T${s}-${t}`, `S9B ${s}`, `s9b-${s}-${t}`])).rows[0].id;
      homeId = await team('H'); awayId = await team('A');
      fixtureId = (await tx.query<{ id: string }>(
        `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
           is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         VALUES ('SPORTSAPI_API',$1,$2::date,$3,false,$4,$5,$6,'SCHEDULED') RETURNING id::text`,
        [`S9B-F-${t}`, partitionOn, editionId, homeId, awayId, iso(KICKOFF)])).rows[0].id;
    });

    // 2. Seal the pre-match snapshot while the fixture is still open.
    const matchSnapshotId = await withConnection(MODULE, async (tx) => {
      const vv = (await tx.query<{ id: string }>(`SELECT id::text FROM module.verdict_composition_version ORDER BY id LIMIT 1`)).rows[0].id;
      const cv = (await tx.query<{ id: string }>(`SELECT id::text FROM module.consensus_rule_version ORDER BY id LIMIT 1`)).rows[0].id;
      const kv = (await tx.query<{ id: string }>(`SELECT id::text FROM module.checksum_algorithm_version WHERE designation='v1'`)).rows[0].id;
      const ms = await tx.query<{ id: string }>(
        `INSERT INTO snapshot.match_snapshot
           (fixture_partition_on, fixture_id, snapshot_point_code, snapshot_as_of,
            verdict_composition_version_id, consensus_rule_version_id, content_checksum, checksum_algorithm_version_id)
         VALUES ($1::date,$2::bigint,$3,$4::timestamptz,$5::bigint,$6::bigint,'\\x00'::bytea,$7::bigint)
         RETURNING id::text`, [partitionOn, fixtureId, point, iso(KICKOFF), vv, cv, kv]);
      return ms.rows[0].id;
    });

    // 3. The fixture progresses: transition to its final lifecycle and record the result.
    await withConnection(INGESTION, async (tx) => {
      if (lifecycle !== 'SCHEDULED') {
        await tx.query(`UPDATE football.fixture SET lifecycle_state_code=$1 WHERE id=$2::bigint AND fixture_partition_on=$3::date`, [lifecycle, fixtureId, partitionOn]);
      }
      resultId = (await tx.query<{ id: string }>(
        `INSERT INTO football.result (fixture_partition_on, fixture_id, home_goals, away_goals)
         VALUES ($1::date,$2::bigint,$3::smallint,$4::smallint) RETURNING id::text`,
        [partitionOn, fixtureId, opts.home, opts.away])).rows[0].id;
    });

    // 4. Governance: authorize the edition into the TRACKED universe (or not).
    if (tracked) {
      await withConnection(ADMIN, async (tx) => {
        const tcId = (await tx.query<{ id: string }>(
          `INSERT INTO governance.tracked_competition
             (provider_code, provider_external_id, competition_type_code, competition_scope_code, tracking_status_code, competition_id)
           VALUES ('SPORTSAPI_API',$1,'LEAGUE','DOMESTIC','TRACKED',$2::bigint) RETURNING id::text`, [`S9B-C-${t}`, compId])).rows[0].id;
        await tx.query(
          `INSERT INTO governance.tracked_edition
             (tracked_competition_id, provider_season_external_id, edition_status_code, authorized_for_ingestion, season_period, competition_edition_id)
           VALUES ($1::bigint,$2,'ACTIVE',true, daterange('2026-01-01','2029-01-01'), $3::bigint)`, [tcId, `S9B-S-${t}`, editionId]);
      });
    }

    return { fixtureId, editionId, resultId, matchSnapshotId };
  }

  async function link(fx: Fx): Promise<{ ordinal: number; outcome: string; resultId: string; derivationId: string }[]> {
    return withConnection(CAL, async (tx) => {
      const { rows } = await tx.query<{ o: number; v: string; r: string; d: string }>(
        `SELECT revision_ordinal o, outcome_value v, result_id::text r, outcome_derivation_version_id::text d
           FROM snapshot.snapshot_outcome_link
          WHERE match_snapshot_id=$1::bigint AND outcome_dimension_code='MATCH_RESULT'
          ORDER BY revision_ordinal`, [fx.matchSnapshotId]);
      return rows.map((x) => ({ ordinal: Number(x.o), outcome: x.v, resultId: x.r, derivationId: x.d }));
    });
  }

  after(async () => { await closeAllPools(); });

  it('(1,4,7,12) HOME_WIN link on a COMPLETED tracked KICKOFF snapshot; derivation version pinned', async () => {
    const fx = await setup({ home: 2, away: 0 });
    const r = await runOutcomeAccrual({ fixtureId: fx.fixtureId, now: new Date() });
    assert.equal(r.linked, 1);
    const links = await link(fx);
    assert.equal(links.length, 1);
    assert.equal(links[0].ordinal, 0);
    assert.equal(links[0].outcome, 'HOME_WIN');
    assert.equal(links[0].resultId, fx.resultId);
    const dv = await withConnection(CAL, (tx) => tx.query<{ id: string }>(
      `SELECT id::text FROM calibration.outcome_derivation_version WHERE outcome_dimension_code='MATCH_RESULT' AND designation='1.0.0'`));
    assert.equal(links[0].derivationId, dv.rows[0].id, 'MATCH_RESULT/1.0.0 pinned on the link');
  });

  it('(2) DRAW and (3) AWAY_WIN derive correctly', async () => {
    const d = await setup({ home: 1, away: 1 });
    await runOutcomeAccrual({ fixtureId: d.fixtureId, now: new Date() });
    assert.equal((await link(d))[0].outcome, 'DRAW');
    const a = await setup({ home: 0, away: 3 });
    await runOutcomeAccrual({ fixtureId: a.fixtureId, now: new Date() });
    assert.equal((await link(a))[0].outcome, 'AWAY_WIN');
  });

  it('(5) a non-COMPLETED fixture produces no outcome', async () => {
    const fx = await setup({ home: 2, away: 0, lifecycle: 'SCHEDULED' });
    const r = await runOutcomeAccrual({ fixtureId: fx.fixtureId, now: new Date() });
    assert.equal(r.considered, 0, 'not eligible');
    assert.equal((await link(fx)).length, 0);
  });

  it('(6,24) a synthetic/non-tracked fixture produces no outcome (cannot enter the corpus)', async () => {
    const fx = await setup({ home: 2, away: 0, tracked: false });
    const r = await runOutcomeAccrual({ fixtureId: fx.fixtureId, now: new Date() });
    assert.equal(r.considered, 0, 'excluded: not in the governed TRACKED universe');
    assert.equal((await link(fx)).length, 0);
  });

  it('(8) a non-KICKOFF snapshot is not attached (KICKOFF-only corpus point)', async () => {
    const fx = await setup({ home: 2, away: 0, point: 'T_MINUS_1D' });
    const r = await runOutcomeAccrual({ fixtureId: fx.fixtureId, now: new Date() });
    assert.equal(r.considered, 0);
    assert.equal((await link(fx)).length, 0);
  });

  it('(9,10,11,13) a revised result appends a superseding ordinal; the original link is immutable', async () => {
    const fx = await setup({ home: 2, away: 0 }); // HOME_WIN
    await runOutcomeAccrual({ fixtureId: fx.fixtureId, now: new Date() });
    const before = await link(fx);
    assert.equal(before.length, 1);
    assert.equal(before[0].outcome, 'HOME_WIN');
    const originalDerivation = before[0].derivationId;

    // Revise the prevailing result to flip the outcome (retain the revision history).
    await withConnection(INGESTION, async (tx) => {
      await tx.query(
        `INSERT INTO football.result_revision (fixture_partition_on, result_id, revision_ordinal, revised_at, previous_home_goals, previous_away_goals, revision_reason)
         VALUES ($1::date,$2::bigint,1,now(),2,0,'disciplinary award')`, [partitionOn, fx.resultId]);
      await tx.query(`UPDATE football.result SET home_goals=0, away_goals=3 WHERE id=$1::bigint AND fixture_partition_on=$2::date`, [fx.resultId, partitionOn]);
    });

    await runOutcomeAccrual({ fixtureId: fx.fixtureId, now: new Date() });
    const afterLinks = await link(fx);
    assert.equal(afterLinks.length, 2, 'a new ordinal appended, original retained');
    assert.deepEqual(afterLinks.map((l) => l.ordinal), [0, 1]);
    assert.equal(afterLinks[0].outcome, 'HOME_WIN', 'original ordinal 0 unchanged (immutable)');
    assert.equal(afterLinks[0].derivationId, originalDerivation, 'ordinal 0 derivation pin unchanged (no retroactive re-score)');
    assert.equal(afterLinks[1].outcome, 'AWAY_WIN', 'superseding ordinal reflects the revised result');
    // Currency records the supersession.
    const cur = await withConnection(CAL, (tx) => tx.query<{ n: string }>(
      `SELECT count(*)::text n FROM snapshot.snapshot_outcome_link_currency
        WHERE match_snapshot_id=$1::bigint AND outcome_dimension_code='MATCH_RESULT'
          AND superseded_ordinal=0 AND superseding_ordinal=1`, [fx.matchSnapshotId]));
    assert.equal(Number(cur.rows[0].n), 1, 'supersession recorded in currency');
    // The result revision is retained.
    const rev = await withConnection(INGESTION, (tx) => tx.query<{ n: string }>(
      `SELECT count(*)::text n FROM football.result_revision WHERE result_id=$1::bigint`, [fx.resultId]));
    assert.equal(Number(rev.rows[0].n), 1, 'result revision retained');
  });

  it('(22) re-running is idempotent — no duplicate link for an unchanged result', async () => {
    const fx = await setup({ home: 3, away: 1 });
    await runOutcomeAccrual({ fixtureId: fx.fixtureId, now: new Date() });
    const rerun = await runOutcomeAccrual({ fixtureId: fx.fixtureId, now: new Date() });
    assert.equal(rerun.linked, 0);
    assert.equal(rerun.skipped, 1);
    assert.equal((await link(fx)).length, 1, 'still exactly one link');
  });

  it('(23) accrual creates NO calibration/confidence/reliability — only the outcome link', async () => {
    const fx = await setup({ home: 1, away: 0 });
    await runOutcomeAccrual({ fixtureId: fx.fixtureId, now: new Date() });
    const counts = await withConnection(CAL, (tx) => tx.query<{ series: string; run: string; result: string; baseline: string }>(
      `SELECT (SELECT count(*) FROM calibration.calibration_series)::text series,
              (SELECT count(*) FROM calibration.calibration_run)::text run,
              (SELECT count(*) FROM calibration.calibration_result)::text result,
              (SELECT count(*) FROM calibration.published_baseline)::text baseline`));
    assert.equal(counts.rows[0].series, '0', 'no calibration series');
    assert.equal(counts.rows[0].run, '0', 'no calibration run');
    assert.equal(counts.rows[0].result, '0', 'no calibration result');
    assert.equal(counts.rows[0].baseline, '0', 'no published baseline');
    // The verdict for this fixture (if any) carries no reliability — this phase never sets it.
    const rel = await withConnection(CAL, (tx) => tx.query<{ n: string }>(
      `SELECT count(*)::text n FROM snapshot.snapshot_verdict v
         JOIN snapshot.match_snapshot ms ON ms.id=v.match_snapshot_id
        WHERE ms.fixture_id=$1::bigint AND v.historical_reliability_baseline_id IS NOT NULL`, [fx.fixtureId]));
    assert.equal(Number(rel.rows[0].n), 0, 'historical_reliability_baseline_id remains NULL');
  });
});
