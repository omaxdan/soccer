// ─────────────────────────────────────────────────────────────────────────────
// F-3 — AN INSERT AND AN UPDATE WERE INDISTINGUISHABLE
//
// `upsertMutable` counted every successful statement as `written`. A pass that
// created 47 fixtures and a pass that updated 47 reported identically —
// `examined 47, written 47, skipped 0` — so doc 40 had to derive the difference
// by counting rows before and after, and doc 45 had to warn readers twice that
// run 51's `written = 47` did not contradict "zero new fixtures".
//
// Nobody reading a finished sweep can count rows before and after. "How much of
// this competition was new?" is the first question the 56-competition sweep will
// be asked, and until now the run could not answer it.
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO MECHANISMS, BECAUSE ONE DOES NOT COVER THE SCHEMA
//
// Doc 47 §2 names `RETURNING (xmax = 0) AS inserted`, which is free and exact —
// on an ordinary table. PostgreSQL REFUSES it on a partitioned one:
//
//     ERROR: cannot retrieve a system column in this context
//
// Seven of the nine relations the primitive writes are ordinary and use it. The
// two that are not — `football.fixture` and `football.result` — already read the
// existing row before writing, for reasons that predate F-3 (identity before
// partition, U-9; the LC-17 revision check), so they state what they already
// know and no extra statement is issued. Test 9 proves the refusal is real
// rather than taking the claim on trust.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT F-3 DOES NOT DO
//
// `operations.write_record` holds `rows_examined`, `rows_written`,
// `rows_skipped` and `rows_rejected` AND NOTHING ELSE. Finding M-3 records that
// "rows inserted / rows updated" were asked for by the S-2 brief and
// deliberately not adopted. Persisting the split is therefore a migration and a
// governance decision; it is not made here, and test 12 pins the ledger's shape
// so that this stays a stated limitation rather than a forgotten one.
// ─────────────────────────────────────────────────────────────────────────────

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';

import {
  INSERTED_FLAG,
  IngestionCounts,
  insertAppendOnly,
  upsertMutable,
} from '../write/index';
import { PROVIDER_CODE } from '../provider/config';
import { ingestScheduleDate } from '../stages/schedule';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);

const entity = (file: string): string =>
  readFileSync(resolve(__dirname, '..', 'entities', file), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// The counter, without a database
// ─────────────────────────────────────────────────────────────────────────────

describe('F-3 · the counter', () => {
  it('1. a write reports which branch ran, and the split covers the writes', () => {
    const counts = new IngestionCounts();
    counts.countUpsert({ id: '1', [INSERTED_FLAG]: true });
    counts.countUpsert({ id: '2', [INSERTED_FLAG]: false });
    counts.countUpsert({ id: '3', [INSERTED_FLAG]: false });

    assert.equal(counts.examined, 3);
    assert.equal(counts.written, 3, 'written still counts every landed statement');
    assert.equal(counts.inserted, 1);
    assert.equal(counts.updated, 2);
    assert.equal(counts.inserted + counts.updated, counts.written);
  });

  it('2. a row without the flag is a wiring fault, and is refused rather than guessed', () => {
    // THE ASSERTION THAT KEEPS THIS HONEST. Defaulting an unknown branch to
    // either bucket would make `inserted + updated === written` quietly false —
    // a telemetry defect of exactly the class F-3 exists to remove, and one that
    // would look plausible in every report.
    const counts = new IngestionCounts();
    assert.throws(() => counts.countUpsert({ id: '1' }), /did not report 'inserted'/);
    assert.throws(() => counts.countUpsert({ id: '1', inserted: 'yes' }), /did not report/);
    assert.equal(counts.written, 0, 'and nothing is counted on the way out');
    assert.equal(counts.examined, 0);
  });

  it('3. folding one counter into another carries the split', () => {
    const fixture = new IngestionCounts();
    fixture.countUpsert({ [INSERTED_FLAG]: true });
    const venue = new IngestionCounts();
    venue.countUpsert({ [INSERTED_FLAG]: false });
    venue.reject('unmapped country');

    const total = new IngestionCounts();
    total.add(fixture);
    total.add(venue);

    assert.equal(total.examined, 3);
    assert.equal(total.written, 2);
    assert.equal(total.inserted, 1);
    assert.equal(total.updated, 1);
    assert.equal(total.rejected, 1);
  });

  it('4. the ledger payload is unchanged — F-3 adds no column to write_record', () => {
    // `operations.write_record` has four count columns and finding M-3 records
    // that the split was considered and not adopted. If this ever grows a key,
    // it is a schema decision that must be taken deliberately, not a side effect
    // of a telemetry change.
    const counts = new IngestionCounts();
    counts.countUpsert({ [INSERTED_FLAG]: true });
    assert.deepEqual(Object.keys(counts.toWriteCounts()).sort(), [
      'rowsExamined',
      'rowsRejected',
      'rowsSkipped',
      'rowsWritten',
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Structural — the wiring cannot silently regress
// ─────────────────────────────────────────────────────────────────────────────

describe('F-3 · wiring', () => {
  it('5. no entity writer counts a write by hand', () => {
    // Every behavioural assertion below would still pass if one call site went
    // back to `counts.written += 1`: the row lands identically, and only that
    // relation's split would quietly stop adding up. This is what catches it.
    for (const file of ['reference.ts', 'participants.ts', 'fixtures.ts']) {
      const source = entity(file);
      assert.ok(
        !/counts\.written\s*\+=/.test(source),
        `${file} must not increment written by hand; countUpsert owns the split`
      );
      const upserts = source.match(/upsertMutable\(tx, \{/g) ?? [];
      const counted = source.match(/counts\.countUpsert\(/g) ?? [];
      assert.equal(
        counted.length,
        upserts.length,
        `${file}: every upsert must be counted through countUpsert`
      );
    }
  });

  it('6. the two partitioned relations state the branch from a read they already made', () => {
    // Not a preference: `RETURNING xmax` is refused on a partitioned target
    // (test 9). The fact must therefore come from the caller — and from the read
    // it ALREADY performs, so F-3 costs no extra round trip anywhere.
    const source = entity('fixtures.ts');
    const sites = source.match(/upsertMutable\(tx, \{[\s\S]*?\n  \}\);/g) ?? [];
    assert.equal(sites.length, 2, 'fixtures.ts writes exactly the two partitioned relations');
    for (const site of sites) {
      assert.match(
        site,
        /existedBeforeWrite: existing !== null/,
        `a partitioned upsert must state the branch:\n${site.slice(0, 200)}`
      );
    }
    // And the read is genuinely prior, not added for this.
    assert.match(source, /const existing = await findFixtureByProviderIdentity\(/);
    assert.match(source, /const existing = await existingResult\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Persistence — the real primitive, the real partitions
// ─────────────────────────────────────────────────────────────────────────────

describe('F-3 persistence (requires a V2 database)', { skip: !hasDatabase }, () => {
  const PREFIX = 'F3TEST';

  after(async () => {
    await closeAllPools();
  });

  /** Every scenario runs inside one rolled-back transaction. */
  async function scenario(fn: (tx: PoolClient) => Promise<void>): Promise<void> {
    await withConnection('pt_pipeline_ingestion', async (tx) => {
      await tx.query('BEGIN');
      try {
        await fn(tx);
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  }

  const competition = (name: string) => ({
    relation: 'football.competition',
    columns: ['provider_code', 'provider_external_id', 'name', 'slug'],
    values: [PROVIDER_CODE, `${PREFIX}-C1`, name, `${PREFIX}-c1`.toLowerCase()],
    conflictTarget: ['provider_code', 'provider_external_id'],
  });

  it('7. an ordinary relation: the first write is a creation, the second is not', async () => {
    await scenario(async (tx) => {
      const counts = new IngestionCounts();

      const first = await upsertMutable(tx, competition('F3 League'));
      counts.countUpsert(first);
      assert.equal(first[INSERTED_FLAG], true, 'a row that did not exist was created');

      const second = await upsertMutable(tx, competition('F3 League Renamed'));
      counts.countUpsert(second);
      assert.equal(second[INSERTED_FLAG], false, 'the same identity again is an update');
      assert.equal(String(second.id), String(first.id), 'and it is the same row');

      assert.equal(counts.written, 2);
      assert.equal(counts.inserted, 1);
      assert.equal(counts.updated, 1);

      // THE WRITE ITSELF MUST STILL BE RIGHT. A telemetry fix that changed what
      // lands would be a worse defect than the one it closes.
      const { rows } = await tx.query<{ n: string; name: string }>(
        `SELECT count(*)::text AS n, max(name) AS name FROM football.competition
          WHERE provider_code = $1 AND provider_external_id = $2`,
        [PROVIDER_CODE, `${PREFIX}-C1`]
      );
      assert.equal(rows[0].n, '1', 'one row, not two');
      assert.equal(rows[0].name, 'F3 League Renamed', 'and the update landed');
    });
  });

  it('8. a caller cannot shadow the flag with a column of its own', async () => {
    await scenario(async (tx) => {
      await assert.rejects(
        () => upsertMutable(tx, { ...competition('F3 Shadow'), returning: ['id', 'inserted'] }),
        /projects 'inserted' itself/
      );
    });
  });

  it('9. RETURNING xmax really is refused on a partitioned relation', async () => {
    // The premise of the whole design, asserted against PostgreSQL rather than
    // assumed. If a future version lifts this, the second mechanism becomes
    // optional — and this test is where that will surface.
    await scenario(async (tx) => {
      await assert.rejects(
        () =>
          tx.query(
            `INSERT INTO football.fixture
               (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
                home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
             VALUES ('X', 'X', '2026-08-01', 1, 1, 2, '2026-08-01T12:00:00Z', 'SCHEDULED')
             ON CONFLICT (provider_code, provider_external_id, fixture_partition_on)
             DO UPDATE SET lifecycle_state_code = EXCLUDED.lifecycle_state_code
             RETURNING id, (xmax = 0) AS inserted`
          ),
        /cannot retrieve a system column/
      );
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // The live-observed case, through the real writer
  // ───────────────────────────────────────────────────────────────────────────

  function event(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: `${PREFIX}-F1`,
      startTimestamp: Math.floor(Date.UTC(2026, 7, 1, 14, 0) / 1000),
      tournament: {
        uniqueTournament: { id: `${PREFIX}-UT1`, name: 'F3 League', category: { name: 'England' } },
      },
      season: { id: `${PREFIX}-S1`, name: '2026/2027', year: '26/27' },
      roundInfo: { round: 1, name: 'Matchweek 1' },
      venue: { id: `${PREFIX}-V1`, name: 'F3 Stadium', city: { name: 'Testville' }, country: { name: 'England' } },
      homeTeam: { id: `${PREFIX}-H1`, name: 'Home United', country: { name: 'England' } },
      awayTeam: { id: `${PREFIX}-A1`, name: 'Away City', country: { name: 'England' } },
      status: { code: 100, description: 'Ended' },
      homeScore: { current: 2, period1: 1 },
      awayScore: { current: 1, period1: 0 },
      ...over,
    };
  }

  const ingest = (tx: PoolClient, over: Record<string, unknown> = {}) =>
    ingestScheduleDate(tx, { get: async () => ({ events: [event(over)] }) } as never, '2026-08-01');

  it('10. a first-ever ingest reports every fixture as new; a re-ingest reports none', async () => {
    await scenario(async (tx) => {
      const first = await ingest(tx);
      const created = first.byRelation.get('football.fixture');
      assert.equal(created?.written, 1);
      assert.equal(created?.inserted, 1, 'the fixture did not exist and was created');
      assert.equal(created?.updated, 0);

      const second = await ingest(tx);
      const again = second.byRelation.get('football.fixture');
      assert.equal(again?.written, 1, 'the statement still lands — DO UPDATE always returns a row');
      assert.equal(again?.inserted, 0, 'BUT NOTHING WAS NEW, which is what F-3 could not say');
      assert.equal(again?.updated, 1);

      // The distinction is a claim about the database, so check the database.
      const { rows } = await tx.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM football.fixture
          WHERE provider_code = $1 AND provider_external_id = $2`,
        [PROVIDER_CODE, `${PREFIX}-F1`]
      );
      assert.equal(rows[0].n, '1', 'one fixture across both passes, as U-9 requires');
    });
  });

  it('11. the result relation splits the same way, and its revision path is untouched', async () => {
    await scenario(async (tx) => {
      const first = await ingest(tx);
      assert.equal(first.byRelation.get('football.result')?.inserted, 1);
      assert.equal(first.byRelation.get('football.result')?.updated, 0);

      const second = await ingest(tx);
      assert.equal(second.byRelation.get('football.result')?.inserted, 0);
      assert.equal(second.byRelation.get('football.result')?.updated, 1);

      const { rows } = await tx.query<{ n: string; home: number }>(
        `SELECT count(*)::text AS n, max(r.home_goals) AS home
           FROM football.result r
           JOIN football.fixture f
             ON f.id = r.fixture_id AND f.fixture_partition_on = r.fixture_partition_on
          WHERE f.provider_external_id = $1`,
        [`${PREFIX}-F1`]
      );
      assert.equal(rows[0].n, '1');
      assert.equal(rows[0].home, 2, 'the score is what the provider sent, both times');
    });
  });

  it('12. every relation in a pass adds up, and the ledger still has nowhere to put it', async () => {
    await scenario(async (tx) => {
      const pass = await ingest(tx);
      for (const [relation, counts] of pass.byRelation) {
        assert.equal(
          counts.inserted + counts.updated,
          counts.written,
          `${relation}: the split must account for every write the primitives made`
        );
      }

      // The stated limitation, pinned. If a migration ever adds these columns,
      // this test fails and the documentation must be corrected with it.
      const { rows } = await tx.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'operations' AND table_name = 'write_record'
            AND column_name IN ('rows_inserted', 'rows_updated')`
      );
      assert.deepEqual(
        rows,
        [],
        'operations.write_record has no column for the split; persisting it needs a migration'
      );
    });
  });

  it('13. an append-only write is a creation by construction, and a repeat is neither', async () => {
    await scenario(async (tx) => {
      await ingest(tx);
      const columns = [
        'competition_edition_id', 'team_id', 'standing_variant', 'as_of_on', 'position',
        'played', 'won', 'drawn', 'lost', 'goals_for', 'goals_against', 'points',
      ];
      const conflictTarget = ['competition_edition_id', 'team_id', 'standing_variant', 'as_of_on'];
      const { rows: ids } = await tx.query<{ edition: string; team: string }>(
        `SELECT f.competition_edition_id::text AS edition, f.home_team_id::text AS team
           FROM football.fixture f WHERE f.provider_external_id = $1`,
        [`${PREFIX}-F1`]
      );
      const row = [ids[0].edition, ids[0].team, 'TOTAL', '2026-08-01', 1, 1, 1, 0, 0, 2, 1, 3];

      const first = await insertAppendOnly(tx, { relation: 'football.standing', columns, rows: [row], conflictTarget });
      assert.equal(first.written, 1);
      assert.equal(first.inserted, 1, 'DO NOTHING cannot update, so a landed row is always new');
      assert.equal(first.updated, 0);

      const second = await insertAppendOnly(tx, { relation: 'football.standing', columns, rows: [row], conflictTarget });
      assert.equal(second.written, 0);
      assert.equal(second.inserted, 0, 'a skipped row is not a creation');
      assert.equal(second.skipped, 1);
    });
  });
});
