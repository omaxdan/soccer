// ─────────────────────────────────────────────────────────────────────────────
// U-9 — FIXTURE IDENTITY ACROSS PARTITIONS
//
// The defect these pin: `resolveFixture` derived `fixture_partition_on` from the
// INCOMING kickoff on every ingest and used it in the ON CONFLICT target. A
// rescheduled fixture therefore looked for itself in the partition its NEW date
// implied, did not find itself, and was inserted a second time — with the same
// provider identity, in a different partition, and with no complaint from the
// database.
//
// PostgreSQL cannot object. A unique constraint on a partitioned relation must
// contain the partition key, `football.fixture` has no parent to bind the
// dependency to, and so nothing in the schema enforces one row per provider
// fixture. THE WRITER IS THE ONLY ENFORCEMENT POINT, and these tests are what
// hold it there. See doc 39.
//
// TWO HALVES. The first needs no database: the partition rule and the lifecycle
// rule are pure, and separating them is what makes the exact defect testable in
// every environment. The second drives real partitions, the real unique
// constraint and the real CHECK, and skips when no database is configured.
//
// The existing suite missed this defect because test 52 postpones a fixture
// WITHOUT MOVING ITS KICKOFF, so the partition never changed. Every reschedule
// test below moves the date, and the year-boundary one moves it across a
// partition.
// ─────────────────────────────────────────────────────────────────────────────

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import {
  AmbiguousFixtureIdentityError,
  findFixtureByProviderIdentity,
  lifecycleTransitionFor,
  partitionForWrite,
  resolveFixture,
  type StoredFixtureIdentity,
} from '../entities/fixtures';
import { fixturePartitionOn, utcDateString } from '../normalise';
import { IngestionCounts } from '../write/index';
import { PROVIDER_CODE } from '../provider/config';
import { ingestScheduleDate } from '../stages/schedule';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);

const stored = (over: Partial<StoredFixtureIdentity> = {}): StoredFixtureIdentity => ({
  id: '1',
  partitionOn: '2026-08-01',
  lifecycleState: 'SCHEDULED',
  ...over,
});

const kickoff = (iso: string): Date => new Date(iso);

// ─────────────────────────────────────────────────────────────────────────────
// The partition rule, without a database
// ─────────────────────────────────────────────────────────────────────────────

describe('U-9 · which partition a fixture is written to', () => {
  it('1. a new fixture derives its partition from the kickoff it first arrived with', () => {
    assert.equal(partitionForWrite(null, kickoff('2026-08-01T14:00:00Z')), '2026-08-01');
    assert.equal(partitionForWrite(null, kickoff('2026-08-01T23:30:00Z')), '2026-08-01');
  });

  it('2. an existing fixture keeps its stored partition, whatever the kickoff now says', () => {
    const existing = stored({ partitionOn: '2026-08-01' });
    for (const moved of [
      '2026-08-15T14:00:00Z', // later, same month
      '2026-09-20T14:00:00Z', // later, across a month
      '2027-03-14T14:00:00Z', // later, across a YEAR — a different partition
    ]) {
      assert.equal(
        partitionForWrite(existing, kickoff(moved)),
        '2026-08-01',
        `${moved} must not move the partition`
      );
    }
  });

  it('3. the partition a reschedule WOULD have produced is a different one', () => {
    // Without this, test 2 could pass trivially. This is the value the old
    // implementation used, and the reason it inserted a second row.
    assert.notEqual(fixturePartitionOn(kickoff('2027-03-14T14:00:00Z')), '2026-08-01');
    assert.equal(fixturePartitionOn(kickoff('2027-03-14T14:00:00Z')), '2027-03-14');
  });

  it('4. the partition is derived in UTC, so a late kickoff does not drift a day', () => {
    assert.equal(partitionForWrite(null, kickoff('2026-12-31T23:59:00Z')), '2026-12-31');
    assert.equal(partitionForWrite(null, kickoff('2027-01-01T00:01:00Z')), '2027-01-01');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The lifecycle rule, without a database
// ─────────────────────────────────────────────────────────────────────────────

describe('U-9 · when a lifecycle transition is recorded', () => {
  it('5. a genuinely new fixture records a creation transition to the state it arrived in', () => {
    assert.deepEqual(lifecycleTransitionFor(null, 'SCHEDULED'), { from: null, to: 'SCHEDULED' });
    // A backfilled fixture that is ALREADY finished was never SCHEDULED in this
    // platform's observation, and must not claim to have been.
    assert.deepEqual(lifecycleTransitionFor(null, 'COMPLETED'), { from: null, to: 'COMPLETED' });
  });

  it('6. an existing fixture whose state has not moved records nothing', () => {
    for (const state of ['SCHEDULED', 'COMPLETED', 'POSTPONED', 'UNKNOWN']) {
      assert.equal(lifecycleTransitionFor(state, state), null, state);
    }
  });

  it('7. a postponement and a reopening are both transitions', () => {
    assert.deepEqual(lifecycleTransitionFor('SCHEDULED', 'POSTPONED'), {
      from: 'SCHEDULED',
      to: 'POSTPONED',
    });
    // "No further snapshots until rescheduled and REOPENED" — the vocabulary's
    // own words. Reopening is only expressible on a surviving row.
    assert.deepEqual(lifecycleTransitionFor('POSTPONED', 'SCHEDULED'), {
      from: 'POSTPONED',
      to: 'SCHEDULED',
    });
  });

  it('8. a known fixture never records a fabricated null → SCHEDULED', () => {
    // The second half of U-9. The old writer looked for the previous state in
    // the partition the NEW kickoff implied, found nothing, and wrote a creation
    // transition for a fixture months old.
    const transition = lifecycleTransitionFor('SCHEDULED', 'SCHEDULED');
    assert.equal(transition, null);
    assert.notDeepEqual(lifecycleTransitionFor('COMPLETED', 'COMPLETED'), { from: null, to: 'SCHEDULED' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The lookup itself, against a recording stand-in
// ─────────────────────────────────────────────────────────────────────────────

interface RecordedQuery {
  readonly sql: string;
  readonly values: readonly unknown[];
}

/** A PoolClient that answers one query and remembers how it was asked. */
function recordingClient(rows: Record<string, unknown>[]): {
  tx: PoolClient;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const tx = {
    async query(sql: string, values: unknown[] = []) {
      queries.push({ sql, values });
      return { rows, rowCount: rows.length };
    },
  } as unknown as PoolClient;
  return { tx, queries };
}

describe('U-9 · the cross-partition lookup', () => {
  it('9. searches on provider identity ALONE — no partition predicate', async () => {
    const { tx, queries } = recordingClient([]);
    await findFixtureByProviderIdentity(tx, 'EXT-1');

    const [query] = queries;
    assert.match(query.sql, /FROM football\.fixture/);
    assert.match(query.sql, /provider_code = \$1/);
    assert.match(query.sql, /provider_external_id = \$2/);
    // THE ASSERTION THAT MATTERS. A partition predicate here reintroduces U-9
    // exactly: the fixture would be sought where its new date says it belongs.
    assert.ok(
      !/fixture_partition_on\s*=/.test(query.sql),
      `the lookup must not filter by partition:\n${query.sql}`
    );
    assert.deepEqual(query.values, [PROVIDER_CODE, 'EXT-1']);
  });

  it('10. returns the partition as text, never as a Date', async () => {
    // ER-01. `date` arrives from the driver at LOCAL midnight; converting it
    // back to a UTC calendar date shifts a day in any zone ahead of UTC, on the
    // one column where a one-day error files the row in the wrong partition.
    const { tx, queries } = recordingClient([
      { id: '7', fixture_partition_on: '2026-08-01', lifecycle_state_code: 'SCHEDULED' },
    ]);
    const found = await findFixtureByProviderIdentity(tx, 'EXT-1');
    assert.match(queries[0].sql, /to_char\(fixture_partition_on, 'YYYY-MM-DD'\)/);
    assert.equal(found?.partitionOn, '2026-08-01');
    assert.equal(typeof found?.partitionOn, 'string');
  });

  it('11. an absent fixture is null, not an error', async () => {
    const { tx } = recordingClient([]);
    assert.equal(await findFixtureByProviderIdentity(tx, 'EXT-NEW'), null);
  });

  it('12. two rows for one provider identity abort, naming both partitions', async () => {
    const { tx } = recordingClient([
      { id: '7', fixture_partition_on: '2026-08-01', lifecycle_state_code: 'POSTPONED' },
      { id: '9', fixture_partition_on: '2027-03-14', lifecycle_state_code: 'COMPLETED' },
    ]);

    await assert.rejects(
      () => findFixtureByProviderIdentity(tx, 'EXT-DUP'),
      (error: unknown) => {
        assert.ok(error instanceof AmbiguousFixtureIdentityError);
        assert.deepEqual(error.occurrences, [
          { id: '7', partitionOn: '2026-08-01' },
          { id: '9', partitionOn: '2027-03-14' },
        ]);
        // The corruption must be investigable from the error alone.
        assert.match(error.message, /2026-08-01/);
        assert.match(error.message, /2027-03-14/);
        assert.match(error.message, /U-9/);
        return true;
      }
    );
  });

  it('13. the abort does not pick, merge, or repair', async () => {
    const { tx, queries } = recordingClient([
      { id: '7', fixture_partition_on: '2026-08-01', lifecycle_state_code: 'POSTPONED' },
      { id: '9', fixture_partition_on: '2027-03-14', lifecycle_state_code: 'COMPLETED' },
    ]);
    await assert.rejects(() =>
      resolveFixture(
        tx,
        {
          externalId: 'EXT-DUP',
          competitionEditionId: '1',
          competitionStageId: null,
          venueId: null,
          isNeutralVenue: false,
          homeTeamId: '1',
          awayTeamId: '2',
          scheduledKickoffAt: kickoff('2027-03-14T14:00:00Z'),
          providerStatusCode: 100,
          providerStatusRaw: { code: 100 },
        },
        new IngestionCounts(),
        new IngestionCounts()
      )
    );
    assert.equal(queries.length, 1, 'nothing is written after an ambiguous identity');
    assert.ok(!queries.some((q) => /INSERT|UPDATE|DELETE/i.test(q.sql)));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Persistence — real partitions, real constraints
// ─────────────────────────────────────────────────────────────────────────────

describe('U-9 persistence (requires a V2 database)', { skip: !hasDatabase }, () => {
  const PREFIX = 'U9TEST';

  after(async () => {
    await closeAllPools();
  });

  const asIngestion = <T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> =>
    withConnection('pt_pipeline_ingestion', fn);

  function event(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: `${PREFIX}-F1`,
      startTimestamp: Math.floor(Date.UTC(2026, 7, 1, 14, 0) / 1000),
      tournament: {
        uniqueTournament: { id: `${PREFIX}-UT1`, name: 'U9 League', category: { name: 'England' } },
      },
      season: { id: `${PREFIX}-S1`, name: '2026/2027' },
      roundInfo: { round: 1, name: 'Matchweek 1' },
      venue: { id: `${PREFIX}-V1`, name: 'U9 Stadium', city: { name: 'Testville' }, country: { name: 'England' } },
      homeTeam: { id: `${PREFIX}-H1`, name: 'Home United', country: { name: 'England' } },
      awayTeam: { id: `${PREFIX}-A1`, name: 'Away City', country: { name: 'England' } },
      status: { code: 0, description: 'Not started' },
      ...over,
    };
  }

  /** Kickoff as the provider sends it: Unix seconds. */
  const at = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

  const stubClient = (events: Record<string, unknown>[]) =>
    ({ get: async () => ({ events }) }) as never;

  const ingest = (tx: PoolClient, over: Record<string, unknown> = {}) =>
    ingestScheduleDate(tx, stubClient([event(over)]), '2026-08-01');

  async function fixtureRows(tx: PoolClient): Promise<
    { id: string; partition: string; kickoff: Date; state: string }[]
  > {
    const { rows } = await tx.query<{
      id: string;
      fixture_partition_on: string;
      scheduled_kickoff_at: Date;
      lifecycle_state_code: string;
    }>(
      `SELECT id::text,
              to_char(fixture_partition_on, 'YYYY-MM-DD') AS fixture_partition_on,
              scheduled_kickoff_at,
              lifecycle_state_code
         FROM football.fixture
        WHERE provider_code = $1 AND provider_external_id = $2
        ORDER BY fixture_partition_on`,
      [PROVIDER_CODE, `${PREFIX}-F1`]
    );
    return rows.map((row) => ({
      id: row.id,
      partition: row.fixture_partition_on,
      kickoff: row.scheduled_kickoff_at,
      state: row.lifecycle_state_code,
    }));
  }

  async function transitions(tx: PoolClient): Promise<{ from: string | null; to: string }[]> {
    const { rows } = await tx.query<{ from_state_code: string | null; to_state_code: string }>(
      `SELECT t.from_state_code, t.to_state_code
         FROM football.fixture_lifecycle_transition t
         JOIN football.fixture f
           ON f.id = t.fixture_id AND f.fixture_partition_on = t.fixture_partition_on
        WHERE f.provider_external_id = $1
        ORDER BY t.transitioned_at, t.id`,
      [`${PREFIX}-F1`]
    );
    return rows.map((row) => ({ from: row.from_state_code, to: row.to_state_code }));
  }

  /** Every scenario runs inside one rolled-back transaction. */
  async function scenario(fn: (tx: PoolClient) => Promise<void>): Promise<void> {
    await asIngestion(async (tx) => {
      await tx.query('BEGIN');
      try {
        await fn(tx);
      } finally {
        await tx.query('ROLLBACK');
      }
    });
  }

  it('14. a new fixture takes its partition from the kickoff, and records its creation', async () => {
    await scenario(async (tx) => {
      await ingest(tx);
      const rows = await fixtureRows(tx);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].partition, '2026-08-01');
      assert.equal(rows[0].state, 'SCHEDULED');
      assert.deepEqual(await transitions(tx), [{ from: null, to: 'SCHEDULED' }]);
    });
  });

  it('15. the same provider identity resolves the stored row, not a new one', async () => {
    await scenario(async (tx) => {
      await ingest(tx);
      const [first] = await fixtureRows(tx);
      await ingest(tx);
      const rows = await fixtureRows(tx);
      assert.equal(rows.length, 1, 're-ingestion must not create a second fixture');
      assert.equal(rows[0].id, first.id, 'the surrogate identity is stable');
      assert.deepEqual(await transitions(tx), [{ from: null, to: 'SCHEDULED' }], 'no new transition');
    });
  });

  it('16. rescheduled LATER within the same month: one row, partition held', async () => {
    await scenario(async (tx) => {
      await ingest(tx);
      const [before] = await fixtureRows(tx);
      await ingest(tx, { startTimestamp: at('2026-08-15T18:00:00Z') });

      const rows = await fixtureRows(tx);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, before.id);
      assert.equal(rows[0].partition, '2026-08-01');
      assert.equal(rows[0].kickoff.toISOString(), '2026-08-15T18:00:00.000Z', 'the kickoff DID move');
    });
  });

  it('17. rescheduled LATER across a month boundary: one row, partition held', async () => {
    await scenario(async (tx) => {
      await ingest(tx);
      await ingest(tx, { startTimestamp: at('2026-09-20T18:00:00Z') });

      const rows = await fixtureRows(tx);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].partition, '2026-08-01');
      assert.equal(utcDateString(rows[0].kickoff), '2026-09-20');
    });
  });

  it('18. rescheduled across a YEAR boundary: one row, still in the 2026 partition', async () => {
    // THE TEST THE SUITE WAS MISSING. A year boundary is a PARTITION boundary:
    // fixture_p2026 and fixture_p2027 are different physical tables, so the old
    // writer's ON CONFLICT could not possibly have matched.
    await scenario(async (tx) => {
      await ingest(tx);
      const [before] = await fixtureRows(tx);

      await ingest(tx, {
        startTimestamp: at('2027-03-14T15:00:00Z'),
        status: { code: 0, description: 'Not started' },
      });

      const rows = await fixtureRows(tx);
      assert.equal(rows.length, 1, 'a cross-year reschedule must not create a second fixture');
      assert.equal(rows[0].id, before.id, 'identity survives the reschedule (E1.13)');
      assert.equal(rows[0].partition, '2026-08-01', 'the partition never advances (PR-03)');
      assert.equal(utcDateString(rows[0].kickoff), '2027-03-14');

      // And it is physically still in the 2026 partition, not merely reporting
      // a 2026 date.
      const { rows: located } = await tx.query<{ partition: string }>(
        `SELECT tableoid::regclass::text AS partition
           FROM football.fixture
          WHERE provider_code = $1 AND provider_external_id = $2`,
        [PROVIDER_CODE, `${PREFIX}-F1`]
      );
      assert.equal(located[0].partition, 'football.fixture_p2026');
    });
  });

  it('19. a kickoff that no longer matches the partition date is the normal state', async () => {
    await scenario(async (tx) => {
      await ingest(tx);
      await ingest(tx, { startTimestamp: at('2026-10-05T19:45:00Z') });

      const [row] = await fixtureRows(tx);
      assert.notEqual(row.partition, utcDateString(row.kickoff));
      assert.ok(
        row.partition < utcDateString(row.kickoff),
        'the partition precedes the kickoff, which ck_fixture__partition_not_after_kickoff permits'
      );
    });
  });

  it('20. postponed then rescheduled: one row, reopened, with a legible history', async () => {
    await scenario(async (tx) => {
      await ingest(tx);
      await ingest(tx, { status: { code: 60, description: 'Postponed' } });
      // Reopened at a new date — the case doc 39 §4 turns on.
      await ingest(tx, {
        status: { code: 0, description: 'Not started' },
        startTimestamp: at('2027-02-10T20:00:00Z'),
      });

      const rows = await fixtureRows(tx);
      assert.equal(rows.length, 1, 'a reopened fixture is the SAME fixture');
      assert.equal(rows[0].partition, '2026-08-01');
      assert.equal(rows[0].state, 'SCHEDULED');
      assert.deepEqual(
        await transitions(tx),
        [
          { from: null, to: 'SCHEDULED' },
          { from: 'SCHEDULED', to: 'POSTPONED' },
          { from: 'POSTPONED', to: 'SCHEDULED' },
        ],
        'the whole postponement is legible, on one fixture'
      );
    });
  });

  it('21. an existing fixture met again never gains a fabricated creation transition', async () => {
    await scenario(async (tx) => {
      await ingest(tx, { status: { code: 100, description: 'Ended' } });
      const historical = await transitions(tx);
      assert.deepEqual(historical, [{ from: null, to: 'COMPLETED' }], 'never SCHEDULED — it arrived finished');

      // Met again, at a different date, exactly as a re-sweep would.
      await ingest(tx, { status: { code: 100, description: 'Ended' }, startTimestamp: at('2026-11-02T20:00:00Z') });

      const after = await transitions(tx);
      assert.deepEqual(after, historical, 'a refresh invents no history');
      assert.ok(
        !after.slice(1).some((t) => t.from === null),
        'no creation transition may appear after the first'
      );
    });
  });

  it('22. two rows for one provider identity are refused, not reconciled', async () => {
    await scenario(async (tx) => {
      await ingest(tx);
      // Manufacture the corruption U-9 describes, using the same statement the
      // OLD writer would have issued: a second row, same identity, different
      // partition. It is accepted, which is the point — the database cannot
      // object, so the writer must.
      await tx.query(
        `INSERT INTO football.fixture
           (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
            home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         SELECT provider_code, provider_external_id, DATE '2027-03-14', competition_edition_id,
                home_team_id, away_team_id, TIMESTAMPTZ '2027-03-14 15:00:00+00', lifecycle_state_code
           FROM football.fixture
          WHERE provider_code = $1 AND provider_external_id = $2`,
        [PROVIDER_CODE, `${PREFIX}-F1`]
      );
      assert.equal((await fixtureRows(tx)).length, 2, 'the schema permits it — that is why U-9 exists');

      await assert.rejects(
        () => findFixtureByProviderIdentity(tx, `${PREFIX}-F1`),
        (error: unknown) => {
          assert.ok(error instanceof AmbiguousFixtureIdentityError);
          assert.equal(error.occurrences.length, 2);
          assert.deepEqual(
            error.occurrences.map((row) => row.partitionOn),
            ['2026-08-01', '2027-03-14']
          );
          return true;
        }
      );

      assert.equal((await fixtureRows(tx)).length, 2, 'and nothing was repaired automatically');
    });
  });

  it('23. U-10 — an EARLIER reschedule still fails the CHECK, loudly and by name', async () => {
    // Deliberately NOT accommodated. Advancing the partition to match would be
    // the corruption U-9 exists to prevent; swallowing the change would leave
    // the platform wrong about when the match is. A named constraint violation
    // is the correct outcome until U-10 is decided on its own terms.
    await scenario(async (tx) => {
      await ingest(tx);
      await assert.rejects(
        () => ingest(tx, { startTimestamp: at('2026-07-20T14:00:00Z') }),
        (error: unknown) => {
          const failure = error as { code?: string; constraint?: string };
          assert.equal(failure.code, '23514', 'a check violation');
          assert.equal(failure.constraint, 'ck_fixture__partition_not_after_kickoff');
          return true;
        }
      );
    });
  });

  it('24. the constraint that makes a later reschedule legal is still in place', async () => {
    // Guards against "fixing" U-10 by weakening the check.
    await asIngestion(async (tx) => {
      const { rows } = await tx.query<{ definition: string }>(
        `SELECT pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conname = 'ck_fixture__partition_not_after_kickoff'
            AND conrelid = 'football.fixture'::regclass`
      );
      assert.equal(rows.length, 1, 'the constraint must exist');
      assert.match(rows[0].definition, /fixture_partition_on <=/);
    });
  });

  it('25. no unique constraint enforces provider identity across partitions', async () => {
    // The premise of the whole fix. If PostgreSQL ever COULD enforce this, the
    // application lookup would be belt and braces rather than the only belt.
    await asIngestion(async (tx) => {
      const { rows } = await tx.query<{ conname: string; definition: string }>(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
           FROM pg_constraint
          WHERE conrelid = 'football.fixture'::regclass AND contype IN ('u','p')`
      );
      for (const row of rows) {
        assert.match(
          row.definition,
          /fixture_partition_on/,
          `${row.conname} must contain the partition key — PostgreSQL requires it, ` +
            'and that is exactly why identity cannot be enforced declaratively'
        );
      }
    });
  });
});
