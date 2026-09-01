// Snapshot orchestration fix — Option A (open-lifecycle selection filter) and
// Option B (per-fixture error isolation in the driver).
//
// DB-FREE guards the selection SQL shape (lifecycle join + is_open, window/order
// preserved). DB-GATED proves: (A) a COMPLETED fixture in the kickoff window is
// NOT selected, an OPEN one is; (B) a thrown seal for one fixture (the migration-015
// guard on a closed fixture reached via the targeted path) is isolated — the run
// resolves with failed>=1 instead of aborting. The DB lifecycle guard is unchanged.

import { after, before, describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import { readFixturesToSeal } from '../read/selection';
import { runSnapshotSealing } from '../driver';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);

// ─────────────────────────────────────────────────────────────────────────────
// DB-FREE — Option A: the selection SQL joins the lifecycle vocabulary and filters
// to explicitly-open fixtures, while preserving the kickoff window and ordering.
// ─────────────────────────────────────────────────────────────────────────────
describe('snapshot selection · open-lifecycle SQL shape (DB-free)', () => {
  test('readFixturesToSeal filters is_open=true and preserves window + order', async () => {
    const calls: { sql: string; params: unknown[] }[] = [];
    const tx = { query: async (sql: string, params: unknown[] = []) => { calls.push({ sql, params }); return { rows: [] }; } } as unknown as PoolClient;
    const from = new Date('2026-08-25T00:00:00Z');
    const to = new Date('2026-09-01T00:00:00Z');
    await readFixturesToSeal(tx, from, to);
    const sql = calls[0].sql;
    assert.match(sql, /JOIN football\.fixture_lifecycle_state s ON s\.code = f\.lifecycle_state_code/);
    assert.match(sql, /s\.is_open = true/);
    // window bounds and ordering unchanged
    assert.match(sql, /f\.scheduled_kickoff_at >= \$1::timestamptz/);
    assert.match(sql, /f\.scheduled_kickoff_at <  \$2::timestamptz/);
    assert.match(sql, /ORDER BY f\.scheduled_kickoff_at, f\.id/);
    assert.deepEqual(calls[0].params, [from, to]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DB-GATED
// ─────────────────────────────────────────────────────────────────────────────
describe('snapshot orchestration fix over a real database', { skip: !hasDatabase }, () => {
  const INGESTION = 'pt_pipeline_ingestion' as const;
  const MODULE = 'pt_pipeline_module' as const;
  const TAG = String(Date.now() % 1_000_000);
  // Kick off just before "now" so the points have arrived and the governing rule
  // versions (seeded long before) are in force at the snapshot as_of.
  const KICKOFF = new Date(Math.floor((Date.now() - 5_000) / 1000) * 1000);
  const WINDOW_FROM = new Date(KICKOFF.getTime() - 3_600_000);
  const WINDOW_TO = new Date(KICKOFF.getTime() + 3_600_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const iso = (d: Date) => d.toISOString();

  let editionId = '', teamA = '', teamB = '', openFixtureId = '', closedFixtureId = '';

  before(async () => {
    await withConnection(INGESTION, async (tx) => {
      const comp = await tx.query<{ id: string }>(
        `INSERT INTO football.competition (provider_code, provider_external_id, name, slug, country_code)
         VALUES ('SPORTSAPI_API',$1,'SnapSel League',$2,'GB') RETURNING id::text`, [`SS-C-${TAG}`, `ss-c-${TAG}`]);
      const ed = await tx.query<{ id: string }>(
        `INSERT INTO football.competition_edition (competition_id, provider_external_id, season_label, season_period)
         VALUES ($1,$2,'SS', daterange('2026-01-01','2029-01-01')) RETURNING id::text`, [comp.rows[0].id, `SS-S-${TAG}`]);
      editionId = ed.rows[0].id;
      const team = async (s: string) => (await tx.query<{ id: string }>(
        `INSERT INTO football.team (provider_code, provider_external_id, name, slug) VALUES ('SPORTSAPI_API',$1,$2,$3) RETURNING id::text`,
        [`SS-T${s}-${TAG}`, `SS ${s}`, `ss-${s}-${TAG}`])).rows[0].id;
      teamA = await team('A'); teamB = await team('B');
      const fixture = async (ext: string, state: string) => (await tx.query<{ id: string }>(
        `INSERT INTO football.fixture (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
           is_neutral_venue, home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         VALUES ('SPORTSAPI_API',$1,$2::date,$3,false,$4,$5,$6,$7) RETURNING id::text`,
        [ext, day(KICKOFF), editionId, teamA, teamB, iso(KICKOFF), state])).rows[0].id;
      openFixtureId = await fixture(`SS-FO-${TAG}`, 'SCHEDULED');   // open
      closedFixtureId = await fixture(`SS-FC-${TAG}`, 'COMPLETED'); // closed
    });
  });
  after(async () => { await closeAllPools(); });

  it('Option A: readFixturesToSeal selects the OPEN fixture and excludes the COMPLETED one', async () => {
    await withConnection(MODULE, async (tx) => {
      const rows = await readFixturesToSeal(tx, WINDOW_FROM, WINDOW_TO);
      const ids = rows.map((r) => r.fixtureId);
      assert.ok(ids.includes(openFixtureId), 'open fixture is selected');
      assert.ok(!ids.includes(closedFixtureId), 'completed fixture is excluded');
    });
  });

  it('Option B: a targeted seal of a CLOSED fixture is isolated — the run resolves, failed>=1, sealed=0', async () => {
    // The targeted path (readFixtureById) does not pre-filter lifecycle, so the
    // closed fixture reaches sealSnapshot and the migration-015 guard raises. Before
    // the fix this aborted the whole run; now it is caught and counted.
    const report = await runSnapshotSealing({ fixtureId: closedFixtureId, now: new Date(KICKOFF.getTime() + 1000) });
    assert.equal(report.sealed, 0, 'nothing sealed for a closed fixture');
    assert.ok(report.failed >= 1, 'the guard rejection was isolated and counted, not thrown');
  });

  it('Option A end-to-end: a range seal over the window does not abort despite the closed fixture present', async () => {
    // With Option A the closed fixture is not selected, so the range run completes
    // (it may seal 0 for lack of readings, but must not throw/abort).
    const report = await runSnapshotSealing({ replayFrom: WINDOW_FROM, replayTo: WINDOW_TO, now: new Date(KICKOFF.getTime() + 1000) });
    assert.equal(report.failed, 0, 'no per-fixture failures: the closed fixture was filtered out of selection');
  });
});
