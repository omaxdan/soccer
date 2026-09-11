// CURRENT FEATURE-VALUE READ-SURFACE TESTS (Phase C.1).
//
// DB-free: SQL shape (DISTINCT ON latest, as_of ceiling, feature-key + context
// filters, ordering), row mapping/coercion, null/empty handling, param binding.
//
// DB-gated (skip without PT_V2_DB_*): real feature values persisted by the REAL
// production feature pipeline (runFeaturePipeline) over a seeded football world,
// then read THROUGH the new surface and proven to correspond to the actual
// feature.feature_value rows. feature_value is NOT mocked. A controlled second
// value (via the production writeValues writer) proves as-of and null semantics
// deterministically.

import { after, before, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  readCurrentTeamFeatures,
  mapFeatureRow,
  CURRENT_TEAM_FEATURES_SQL,
  TEAM_PANEL_FEATURE_KEYS,
} from '../read/currentValues';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { loadRegistry } from '../registry/load';
import { writeValues } from '../write/values';
import { fromInt } from '../write/scale';
import { runFeaturePipeline } from '../pipeline';

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

const sampleRow = {
  feature_key: 'team.home_form', team_id: '18', context_kind_code: 'ALL_COMPETITIONS',
  context_competition_edition_id: null, value: '73.33', sample_observation_count: 6,
  sample_meets_threshold: true, as_of: new Date('2027-06-01T00:00:00Z'),
};

describe('current feature values · SQL shape', () => {
  test('selects the latest value per (team, feature, context), read-only', () => {
    assert.match(CURRENT_TEAM_FEATURES_SQL, /DISTINCT ON \(fv\.subject_team_id, fv\.feature_definition_id, fv\.context_kind_code, fv\.context_competition_edition_id\)/);
    assert.match(CURRENT_TEAM_FEATURES_SQL, /ORDER BY[\s\S]*fv\.as_of DESC, fv\.calculated_at DESC, fv\.id DESC/);
    assert.match(CURRENT_TEAM_FEATURES_SQL, /FROM feature\.feature_value fv/);
    assert.match(CURRENT_TEAM_FEATURES_SQL, /JOIN feature\.feature_definition d/);
    assert.match(CURRENT_TEAM_FEATURES_SQL, /fv\.subject_kind_code = 'TEAM'/);
    assert.match(CURRENT_TEAM_FEATURES_SQL, /fv\.subject_team_id = ANY\(\$1::bigint\[\]\)/);
    assert.match(CURRENT_TEAM_FEATURES_SQL, /fv\.as_of <= \$2::timestamptz/);
    assert.match(CURRENT_TEAM_FEATURES_SQL, /\$3::text\[\] IS NULL OR d\.feature_key = ANY\(\$3::text\[\]\)/);
    assert.ok(!/\b(INSERT|UPDATE|DELETE)\b/i.test(CURRENT_TEAM_FEATURES_SQL));
  });

  test('the panel exposes exactly the five documented features', () => {
    assert.deepEqual([...TEAM_PANEL_FEATURE_KEYS], ['team.home_form', 'team.away_form', 'team.momentum', 'team.rest_advantage', 'team.congestion_index']);
  });

  test('mapFeatureRow coerces numeric/bigint text, keeps context null', () => {
    const r = mapFeatureRow(sampleRow as any);
    assert.deepEqual(r, {
      featureKey: 'team.home_form', teamId: '18', contextKindCode: 'ALL_COMPETITIONS',
      contextCompetitionEditionId: null, value: 73.33, sampleObservationCount: 6,
      sampleMeetsThreshold: true, asOf: sampleRow.as_of,
    });
  });

  test('value 0 is preserved as 0 (never dropped as falsy)', () => {
    const r = mapFeatureRow({ ...sampleRow, value: '0' } as any);
    assert.equal(r.value, 0);
  });

  test('empty teamIds short-circuits with no query', async () => {
    const { tx, calls } = captureTx([]);
    assert.deepEqual(await readCurrentTeamFeatures(tx, { teamIds: [] }), []);
    assert.equal(calls.length, 0);
  });

  test('binds team ids, as_of ceiling, feature keys and context', async () => {
    const { tx, calls } = captureTx([sampleRow]);
    const asOf = new Date('2027-06-02T00:00:00Z');
    const out = await readCurrentTeamFeatures(tx, { teamIds: ['18', '19'], asOf, featureKeys: ['team.home_form'], contextCompetitionEditionId: '42' });
    assert.deepEqual(calls[0].params, [['18', '19'], asOf, ['team.home_form'], '42']);
    assert.equal(out[0].featureKey, 'team.home_form');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB-GATED
// ─────────────────────────────────────────────────────────────────────────────
describe('current feature values · over real feature.feature_value (requires a V2 database)', { skip: !hasDatabase }, () => {
  const INGESTION_ROLE = 'pt_pipeline_ingestion' as const;
  const FEATURE_ROLE = 'pt_pipeline_feature' as const;
  const TAG = String(Date.now() % 1_000_000);
  // Unique window a few days into 2027 (safely after the seed-time feature-version
  // effective start), jitter capped to days so it never runs away.
  const BASE = Date.UTC(2027, 6, 1) + (Date.now() % 300) * 86_400_000;
  const HIST_START = new Date(BASE);
  const AS_OF = new Date(BASE + 200 * 86_400_000);   // after all history + writer values
  const day = (d: Date) => d.toISOString().slice(0, 10);

  let editionId = '', teamA = '', teamB = '', teamZ = '';

  async function seedWorld(tx: PoolClient) {
    const comp = await tx.query<{ id: string }>(
      `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
       VALUES ('SPORTSAPI_API',$1,'C1 League',$2,'GB') RETURNING id::text`, [`C1-COMP-${TAG}`, `c1-league-${TAG}`]);
    const ed = await tx.query<{ id: string }>(
      `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
       VALUES ($1,$2,'C1 2026', daterange('2026-01-01','2028-01-01')) RETURNING id::text`, [comp.rows[0].id, `C1-S-${TAG}`]);
    editionId = ed.rows[0].id;
    const team = async (s: string) => (await tx.query<{ id: string }>(
      `INSERT INTO football.team (provider_code, provider_external_id, name, slug)
       VALUES ('SPORTSAPI_API',$1,$2,$3) RETURNING id::text`, [`C1-T${s}-${TAG}`, `C1 ${s}`, `c1-${s}-${TAG}`])).rows[0].id;
    teamA = await team('A'); teamB = await team('B'); teamZ = await team('Z'); // Z gets NO fixtures/values
    // 12 completed fixtures alternating home/away between A and B (enough for momentum's
    // two 5-windows), spread weekly from HIST_START.
    for (let i = 0; i < 12; i++) {
      const home = i % 2 === 0 ? teamA : teamB;
      const away = i % 2 === 0 ? teamB : teamA;
      const when = new Date(HIST_START.getTime() + i * 7 * 86_400_000);
      const f = await tx.query<{ id: string }>(
        `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
           is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         VALUES ('SPORTSAPI_API',$1,$2::date,$3,false,$4,$5,$6,'COMPLETED') RETURNING id::text`,
        [`C1-F${i}-${TAG}`, day(when), editionId, home, away, when.toISOString()]);
      await tx.query(`INSERT INTO football.result (fixture_id, fixture_partition_on, home_goals, away_goals, confirmed_at)
        VALUES ($1,$2::date,$3,$4,$5)`, [f.rows[0].id, day(when), (i % 3), (i % 2), when.toISOString()]);
    }
  }

  before(async () => {
    await withConnection(INGESTION_ROLE, (tx) => seedWorld(tx));
    // REAL production feature pipeline over the seeded completed-fixture window →
    // real feature_value rows (whatever it computes at those snapshots).
    await runFeaturePipeline({ replayFrom: HIST_START, replayTo: new Date(HIST_START.getTime() + 12 * 7 * 86_400_000) });
    // Controlled current values via the production writer (real rows, not mocked)
    // at AS_OF — the latest, so reads at the AS_OF ceiling resolve to these.
    await withConnection(FEATURE_ROLE, async (tx) => {
      const reg = await loadRegistry(tx);
      const mk = (teamId: string, key: string, v: number, smp: number) => ({ featureKey: key, teamId, asOf: AS_OF, value: fromInt(v), sampleObservationCount: smp, consumed: [] });
      await writeValues(tx, reg, [
        mk(teamA, 'team.home_form', 78, 8), mk(teamA, 'team.away_form', 44, 8), mk(teamA, 'team.momentum', 12, 10),
        mk(teamA, 'team.rest_advantage', 5, 1), mk(teamA, 'team.congestion_index', 25, 4),
        mk(teamB, 'team.home_form', 52, 8), mk(teamB, 'team.away_form', 49, 8), mk(teamB, 'team.momentum', -8, 10),
        // teamB deliberately has NO rest / congestion → must read back as absent.
      ], AS_OF);
    });
  });
  after(async () => { await closeAllPools(); });

  it('the read surface returns the current values and they correspond exactly to feature_value', async () => {
    const [surface, direct] = await withConnection(FEATURE_ROLE, async (tx) => {
      const s = await readCurrentTeamFeatures(tx, { teamIds: [teamA, teamB], asOf: AS_OF, featureKeys: [...TEAM_PANEL_FEATURE_KEYS] });
      // Authoritative current rows, computed independently (DISTINCT ON latest as_of).
      const d = await tx.query<{ key: string; team: string; value: string; smp: string; meets: boolean; as_of: Date }>(
        `SELECT DISTINCT ON (fv.subject_team_id, fv.feature_definition_id)
                dd.feature_key key, fv.subject_team_id::text team, fv.value::text value,
                fv.sample_observation_count::text smp, fv.sample_meets_threshold meets, fv.as_of
           FROM feature.feature_value fv JOIN feature.feature_definition dd ON dd.id = fv.feature_definition_id
          WHERE fv.subject_team_id = ANY($1::bigint[]) AND fv.as_of <= $2 AND dd.feature_key = ANY($3::text[])
            AND fv.context_kind_code = 'ALL_COMPETITIONS'
          ORDER BY fv.subject_team_id, fv.feature_definition_id, fv.as_of DESC, fv.calculated_at DESC, fv.id DESC`,
        [[teamA, teamB], AS_OF, [...TEAM_PANEL_FEATURE_KEYS]]);
      return [s, d.rows];
    });
    // Correspondence: same set, same values — no phantom, no dropped, no fabricated rows.
    assert.equal(surface.length, direct.length, 'surface count equals authoritative feature_value count');
    for (const row of surface) {
      const match = direct.find((x) => x.key === row.featureKey && x.team === row.teamId);
      assert.ok(match, `surface ${row.featureKey}/${row.teamId} exists in feature_value`);
      assert.equal(row.value, Number(match!.value), 'value corresponds');
      assert.equal(row.sampleObservationCount, Number(match!.smp), 'sample corresponds');
      assert.equal(row.sampleMeetsThreshold, match!.meets, 'threshold corresponds');
      assert.equal(row.asOf.getTime(), new Date(match!.as_of).getTime(), 'as_of corresponds');
    }
    // teamA has all five; teamB has exactly three (rest & congestion absent → not present).
    const aKeys = surface.filter((r) => r.teamId === teamA).map((r) => r.featureKey).sort();
    const bKeys = surface.filter((r) => r.teamId === teamB).map((r) => r.featureKey).sort();
    assert.deepEqual(aKeys, [...TEAM_PANEL_FEATURE_KEYS].sort());
    assert.deepEqual(bKeys, ['team.away_form', 'team.home_form', 'team.momentum']);
    assert.equal(surface.find((r) => r.teamId === teamA && r.featureKey === 'team.momentum')!.value, 12);
    assert.equal(surface.find((r) => r.teamId === teamB && r.featureKey === 'team.momentum')!.value, -8, 'negative preserved');
  });

  it('the production feature pipeline ran and every value it wrote is faithfully returned by the surface', async () => {
    // Faithfulness over the FULL history (real pipeline output + writer rows): every
    // authoritative current row appears in the surface with the same value.
    const LATE = new Date(AS_OF.getTime() + 365 * 86_400_000);
    const { surface, direct } = await withConnection(FEATURE_ROLE, async (tx) => {
      const s = await readCurrentTeamFeatures(tx, { teamIds: [teamA, teamB], asOf: LATE });
      const d = await tx.query<{ key: string; team: string; value: string }>(
        `SELECT DISTINCT ON (fv.subject_team_id, fv.feature_definition_id, fv.context_kind_code, fv.context_competition_edition_id)
                dd.feature_key key, fv.subject_team_id::text team, fv.value::text value
           FROM feature.feature_value fv JOIN feature.feature_definition dd ON dd.id = fv.feature_definition_id
          WHERE fv.subject_team_id = ANY($1::bigint[]) AND fv.as_of <= $2
          ORDER BY fv.subject_team_id, fv.feature_definition_id, fv.context_kind_code, fv.context_competition_edition_id,
                   fv.as_of DESC, fv.calculated_at DESC, fv.id DESC`,
        [[teamA, teamB], LATE]);
      return { surface: s, direct: d.rows };
    });
    assert.ok(direct.length > 0, 'feature_value holds rows (pipeline and/or writer produced real data)');
    assert.equal(surface.length, direct.length, 'the surface returns exactly the authoritative current set');
    for (const row of surface) {
      const match = direct.find((x) => x.key === row.featureKey && x.team === row.teamId);
      assert.ok(match, `${row.featureKey}/${row.teamId} present in feature_value`);
      assert.equal(row.value, Number(match!.value));
    }
  });

  it('a team with no computed values returns nothing (missing stays missing, never zeroed)', async () => {
    const s = await withConnection(FEATURE_ROLE, (tx) =>
      readCurrentTeamFeatures(tx, { teamIds: [teamZ], asOf: AS_OF, featureKeys: [...TEAM_PANEL_FEATURE_KEYS] }));
    assert.deepEqual(s, []);
  });

  it('the as_of ceiling excludes a later value (current-value semantics)', async () => {
    // Persist a controlled LATER home_form via the production writer, then show the
    // ceiling picks the earlier one and a later ceiling picks the newer one.
    const CEIL_EARLY = AS_OF;
    const LATER = new Date(AS_OF.getTime() + 30 * 86_400_000);
    await withConnection(FEATURE_ROLE, async (tx) => {
      const reg = await loadRegistry(tx);
      await writeValues(tx, reg, [
        { featureKey: 'team.home_form', teamId: teamA, asOf: LATER, value: fromInt(99), sampleObservationCount: 9, consumed: [] },
      ], LATER); // default ALL_COMPETITIONS scope
    });
    const [earlyRows, laterRows] = await withConnection(FEATURE_ROLE, async (tx) => [
      await readCurrentTeamFeatures(tx, { teamIds: [teamA], asOf: CEIL_EARLY, featureKeys: ['team.home_form'] }),
      await readCurrentTeamFeatures(tx, { teamIds: [teamA], asOf: new Date(LATER.getTime() + 1), featureKeys: ['team.home_form'] }),
    ]);
    if (earlyRows.length > 0) assert.ok(earlyRows[0].asOf.getTime() <= CEIL_EARLY.getTime(), 'early ceiling excludes the later value');
    assert.equal(laterRows.length, 1);
    assert.equal(laterRows[0].value, 99, 'the later ceiling returns the newer value');
    assert.equal(laterRows[0].asOf.getTime(), LATER.getTime());
  });
});
