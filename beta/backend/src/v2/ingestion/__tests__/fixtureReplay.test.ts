// ─────────────────────────────────────────────────────────────────────────────
// CONTROLLED FIXTURE-INGESTION REPLAY PROOF
//
// The real pager and the real writer, run against the four captured Brasileirão
// responses and a real V2 database built from the real migrations and seed. No
// network, no quota, no sweep.
//
// WHY THIS EXISTS. Every previous proof of the writer used a synthetic event
// shaped the way the writer expects. This one uses the shapes the provider
// actually sent — including the four postponed fixtures with `{}` for a score,
// the sixteen forward events whose slug is in away-home order, the round-4
// catch-ups sitting among round 19, and the page whose fixtures straddle the
// window floor. Those are the conditions that break an ingestion pipeline, and
// none of them can be discovered from a fixture someone wrote by hand.
//
// SKIPS, rather than fails, without a database or without the captures. The
// evidence directory is ignored in some checkouts.
// ─────────────────────────────────────────────────────────────────────────────

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { PoolClient } from 'pg';

import { FIXTURE_WINDOW, pageSeasonEvents, sweepSeason } from '../provider/pager';
import { AmbiguousFixtureIdentityError, findFixtureByProviderIdentity } from '../entities/fixtures';
import { PROVIDER_CODE } from '../provider/config';
import { withConnection } from '../../db/tx';
import { closeAllPools } from '../../db/pool';
import {
  BRASILEIRAO,
  SCOPE,
  capturedPageEvents,
  capturedSource,
  fixtureRow,
  hasEvidence,
  rawOf,
  tally,
  writeEvents,
} from './support/replay';

const hasDatabase = Boolean(process.env.PT_V2_DB_HOST && process.env.PT_V2_DB_NAME);
const runnable = hasDatabase && hasEvidence();

/** Provider ids of the representative fixtures, chosen from the captures. */
const COMPLETED = '15235404'; // Athletico 2–0 Internacional, 2026-07-25, HT 1–0
const POSTPONED = '15235414'; // Atlético Mineiro v Red Bull Bragantino, scores `{}`
const AT_FLOOR = '15235584'; // 2026-05-31T14:00Z — the earliest fixture inside the window
const BELOW_FLOOR = '15235580'; // 2026-05-30T23:00Z — fifteen hours outside it
const SLUG_REVERSED = '15235422'; // slug `palmeiras-fluminense`; Fluminense is HOME
const UNPLAYED = '15235422'; // status 0, `{}` scores, no winnerCode

// ─────────────────────────────────────────────────────────────────────────────
// Pager over the captures — no database needed
// ─────────────────────────────────────────────────────────────────────────────

describe('replay · the walk over captured evidence', { skip: !hasEvidence() }, () => {
  it('1. `last` walks pages 0, 1, 2 and stops at the historical floor', async () => {
    const source = capturedSource();
    const result = await pageSeasonEvents(source, {
      ...BRASILEIRAO,
      direction: 'last',
      callBudget: 10,
    });

    assert.deepEqual(
      result.pages.map((page) => page.page),
      [0, 1, 2],
      'page 2 is FETCHED before it can be known to be outside the window'
    );
    assert.equal(result.stoppedBecause, 'BEYOND_WINDOW');
    assert.equal(result.callsSpent, 3);
    assert.deepEqual(
      result.pages.map((page) => page.eventCount),
      [30, 30, 30],
      '120 events read across four captures'
    );
    assert.deepEqual(
      result.pages.map((page) => page.inWindowCount),
      [30, 17, 0],
      'page 0 wholly inside, page 1 straddles the floor, page 2 wholly outside'
    );
    assert.equal(result.events.length, 47);
    assert.deepEqual(result.orderingAnomalies, [], 'ordering held on every page');
    assert.deepEqual(result.rejections, [], 'every captured event was interpretable');
  });

  it('2. the page that straddles the floor keeps its in-window fixtures', async () => {
    // The failure this guards against is a pager that stops on the first page
    // containing ANY out-of-window fixture, silently losing the 17 on page 1
    // that belong. 15235584 kicks off at 2026-05-31T14:00Z and 15235580 at
    // 2026-05-30T23:00Z — fifteen hours apart, same page, opposite sides.
    const source = capturedSource();
    const result = await pageSeasonEvents(source, { ...BRASILEIRAO, direction: 'last', callBudget: 10 });
    const ids = new Set(result.events.map((event) => event.providerEventId));

    assert.ok(ids.has(AT_FLOOR), 'a fixture ON the floor is inside the window');
    assert.ok(!ids.has(BELOW_FLOOR), 'a fixture fifteen hours below it is not');
    assert.equal(result.pages[1].inWindowCount, 17);
  });

  it('3. `next` is fetched, is entirely beyond the window, and yields nothing', async () => {
    // Correct behaviour, not a defect: `next/0` opens on 2026-08-15 and the
    // window closes on 2026-08-11. Recorded here so the forward-window decision
    // is made deliberately rather than discovered as a missing half.
    const source = capturedSource();
    const result = await pageSeasonEvents(source, { ...BRASILEIRAO, direction: 'next', callBudget: 10 });

    assert.equal(result.callsSpent, 1);
    assert.equal(result.pages[0].eventCount, 30, 'the page WAS read');
    assert.equal(result.pages[0].inWindowCount, 0, 'and none of it belongs to this window');
    assert.equal(result.events.length, 0);
    assert.equal(result.stoppedBecause, 'BEYOND_WINDOW');
  });

  it('4. both directions together cost four calls and carry 47 fixtures', async () => {
    const source = capturedSource();
    const { last, next } = await sweepSeason(source, { ...BRASILEIRAO, callBudget: 10 });
    assert.equal(last.callsSpent + next.callsSpent, 4);
    assert.equal(last.events.length + next.events.length, 47);
    assert.deepEqual(
      source.calls.map((call) => `${call.key}/${call.page}`),
      [
        'tournament_season_events_last/0',
        'tournament_season_events_last/1',
        'tournament_season_events_last/2',
        'tournament_season_events_next/0',
      ],
      'no match-level endpoint, and no page fetched twice'
    );
  });

  it('5. every selected event carries three DISTINCT competition identifiers', async () => {
    const source = capturedSource();
    const { last } = await sweepSeason(source, { ...BRASILEIRAO, callBudget: 10 });
    for (const event of last.events) {
      assert.equal(event.competitionProviderId, '325', 'uniqueTournament.id');
      assert.equal(event.tournamentInstanceProviderId, '83', 'tournament.id — NOT the competition');
      assert.equal(event.seasonProviderId, '87678', 'season.id — NOT either of the others');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The writer, against a real database
// ─────────────────────────────────────────────────────────────────────────────

describe('replay · fixture ingestion against captured evidence', { skip: !runnable }, () => {
  after(async () => {
    await closeAllPools();
  });

  /** One rolled-back transaction per scenario. Nothing survives a test. */
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

  /** Pager over the captures, then the real writer over what it selected. */
  async function replay(tx: PoolClient) {
    const { last, next } = await sweepSeason(capturedSource(), { ...BRASILEIRAO, callBudget: 10 });
    const selected = [...last.events, ...next.events];
    const counts = await writeEvents(tx, rawOf(selected), 'brasileirao-2026');
    return { selected, counts };
  }

  it('6. the window produces the expected fixture universe', async () => {
    await scenario(async (tx) => {
      const { selected } = await replay(tx);
      assert.equal(selected.length, 47, '47 of 120 captured events fall inside the window');

      const counted = await tally(tx);
      assert.equal(counted.fixtures, 47);
      assert.equal(counted.completed, 43);
      assert.equal(counted.postponed, 4);
      assert.equal(counted.scheduled, 0, 'the window closes before the forward feed opens');
      assert.equal(counted.competitions, 1, 'one competition — uniqueTournament.id 325');
      assert.equal(counted.teams, 20);
      assert.equal(counted.venues, 20);

      // F-1, CLOSED (doc 42). season.id 87678 was two editions here, split at
      // 1 July by a period derived from each fixture's own kickoff.
      assert.equal(counted.editions, 1, 'one provider season is one edition');
    });
  });

  it('6a. F-1 — one provider season produces exactly one edition', async () => {
    await scenario(async (tx) => {
      await replay(tx);
      const { rows } = await tx.query<{ provider_external_id: string; n: string }>(
        `${SCOPE} SELECT ce.provider_external_id, count(*)::text AS n
           FROM football.competition_edition ce
          WHERE ce.id IN (SELECT id FROM scoped_edition)
          GROUP BY 1 HAVING count(*) > 1`
      );
      assert.deepEqual(rows, [], 'season.id 87678 resolves to one competition_edition');

      // And it is dated from season.year, not from any fixture's kickoff.
      const { rows: period } = await tx.query<{ ext: string; period: string }>(
        `${SCOPE} SELECT ce.provider_external_id AS ext, ce.season_period::text AS period
           FROM football.competition_edition ce WHERE ce.id IN (SELECT id FROM scoped_edition)`
      );
      assert.equal(period[0].ext, '87678');
      assert.equal(period[0].period, '[2026-01-01,2027-01-01)');
    });
  });

  it('7. a completed fixture keeps its full-time and half-time score', async () => {
    await scenario(async (tx) => {
      await replay(tx);
      const row = await fixtureRow(tx, COMPLETED);
      assert.ok(row);
      assert.equal(row.lifecycle_state_code, 'COMPLETED');
      assert.equal(row.home_team, 'Athletico');
      assert.equal(row.away_team, 'Internacional');
      assert.equal(row.home_goals, 2, 'homeScore.current / normaltime');
      assert.equal(row.away_goals, 0);
      assert.equal(row.home_goals_half_time, 1, 'homeScore.period1');
      assert.equal(row.away_goals_half_time, 0);
    });
  });

  it('8. a postponed fixture is scoreless — NOT nil-nil', async () => {
    // The single most damaging thing this pipeline could do. `homeScore: {}`
    // coerced to zero is a 0–0 that nothing downstream would ever question.
    await scenario(async (tx) => {
      await replay(tx);
      const row = await fixtureRow(tx, POSTPONED);
      assert.ok(row);
      assert.equal(row.lifecycle_state_code, 'POSTPONED');
      assert.equal(row.home_goals, null, 'no result row exists for it');
      assert.equal(row.away_goals, null);

      const { rows } = await tx.query<{ n: string }>(
        `${SCOPE} SELECT count(*)::text AS n
           FROM football.result r
           JOIN scoped_fixture f
             ON f.id = r.fixture_id AND f.fixture_partition_on = r.fixture_partition_on
          WHERE f.lifecycle_state_code <> 'COMPLETED'`
      );
      assert.equal(rows[0].n, '0', 'no unfinished fixture anywhere carries a result');
    });
  });

  it('9. results exist for completed fixtures and for no others', async () => {
    await scenario(async (tx) => {
      await replay(tx);
      const counted = await tally(tx);
      assert.equal(counted.results, 43, 'one per completed fixture, none for the four postponed');
      assert.equal(counted.results, counted.completed);
    });
  });

  it('10. status codes map to the three lifecycle states, and nothing else', async () => {
    await scenario(async (tx) => {
      await replay(tx);
      const { rows } = await tx.query<{ provider_status_raw: string; lifecycle_state_code: string; n: string }>(
        `${SCOPE} SELECT provider_status_raw, lifecycle_state_code, count(*)::text AS n
           FROM scoped_fixture GROUP BY 1, 2 ORDER BY 3 DESC`
      );
      const byState = new Map(rows.map((row) => [row.lifecycle_state_code, Number(row.n)]));
      assert.equal(byState.get('COMPLETED'), 43, 'status.code 100');
      assert.equal(byState.get('POSTPONED'), 4, 'status.code 60');
      assert.equal(byState.get('UNKNOWN'), undefined, 'no captured status was unmapped');
      // "The provider's own string, retained for mapping diagnosis. Load-bearing
      // for nothing." Sealing branches on lifecycle_state_code, never on this.
      assert.deepEqual(
        rows.map((row) => row.provider_status_raw).sort(),
        ['Ended', 'Postponed'],
        'the provider description is retained beside the mapped state'
      );
    });
  });

  it('11. unplayed fixtures from `next/0` normalise exactly as postponed ones do', async () => {
    // The configured window excludes the forward feed entirely, so this replays
    // `next/0` DIRECTLY. It is a proof about score normalisation, not a change
    // to the window — which is left exactly as configured.
    await scenario(async (tx) => {
      const unplayed = capturedPageEvents('tournament_season_events_next', 0);
      assert.equal(unplayed.length, 30);
      await writeEvents(tx, unplayed, 'next-0-direct');

      const counted = await tally(tx);
      assert.equal(counted.fixtures, 30);
      assert.equal(counted.scheduled, 30, 'status.code 0 → SCHEDULED');
      assert.equal(counted.results, 0, 'thirty unplayed fixtures, zero results');

      const row = await fixtureRow(tx, UNPLAYED);
      assert.equal(row?.lifecycle_state_code, 'SCHEDULED');
      assert.equal(row?.home_goals, null);
      assert.equal(row?.away_goals, null);
    });
  });

  it('12. home and away come from the explicit fields, never from `slug`', async () => {
    // Event 15235422 is slugged `palmeiras-fluminense` and Fluminense is HOME.
    // Sixteen of the thirty forward events are slugged in away-home order, so a
    // slug-derived fixture would invert better than half the forward universe.
    await scenario(async (tx) => {
      await writeEvents(tx, capturedPageEvents('tournament_season_events_next', 0), 'next-0-direct');
      const row = await fixtureRow(tx, SLUG_REVERSED);
      assert.equal(row?.home_team, 'Fluminense', 'homeTeam.name, not the first slug segment');
      assert.equal(row?.away_team, 'Palmeiras');
    });
  });

  it('13. venue identity, name, capacity, city, country and coordinates persist', async () => {
    await scenario(async (tx) => {
      await replay(tx);
      const row = await fixtureRow(tx, COMPLETED);
      assert.equal(row?.venue_external_id, '1129');
      assert.equal(row?.venue_name, 'Arena da Baixada');
      assert.equal(Number(row?.venue_capacity), 43_000);
      assert.equal(row?.venue_city, 'Curitiba');
      // `ck_country__code_is_iso3166_1` governs the vocabulary as alpha-2; the
      // provider sends a country NAME and the mapping resolves it.
      assert.equal(row?.venue_country, 'BR', 'venue.country.name "Brazil" → the governed code');
      assert.equal(Number(row?.latitude), -25.44793);
      assert.equal(Number(row?.longitude), -49.27703);

      const { rows } = await tx.query<{ n: string }>(
        `${SCOPE} SELECT count(*)::text AS n FROM football.venue
          WHERE id IN (SELECT venue_id FROM scoped_fixture)
            AND (latitude IS NULL OR longitude IS NULL OR capacity IS NULL OR city IS NULL)`
      );
      assert.equal(rows[0].n, '0', 'all 20 venues arrived complete');
    });
  });

  it('14. the embedded payload is sufficient — no second endpoint is reached', async () => {
    await scenario(async (tx) => {
      const source = capturedSource();
      const { last, next } = await sweepSeason(source, { ...BRASILEIRAO, callBudget: 10 });
      await writeEvents(tx, rawOf([...last.events, ...next.events]));

      for (const call of source.calls) {
        assert.match(call.key, /^tournament_season_events_(last|next)$/, 'season feed only');
      }
      assert.equal(source.calls.length, 4);
      // And the fixtures are nonetheless complete: competition, edition, stage,
      // venue, both teams and the result all resolved from the same payload.
      const { rows } = await tx.query<{ n: string }>(
        `${SCOPE} SELECT count(*)::text AS n FROM scoped_fixture
          WHERE venue_id IS NULL OR competition_stage_id IS NULL`
      );
      assert.equal(rows[0].n, '0');
    });
  });

  it('15. replaying the identical evidence is idempotent', async () => {
    await scenario(async (tx) => {
      await replay(tx);
      const first = await tally(tx);
      const firstIds = await providerIds(tx);

      await replay(tx);
      const second = await tally(tx);

      assert.deepEqual(second, first, 'a second identical replay changes nothing');
      assert.deepEqual(await providerIds(tx), firstIds, 'provider external ids are stable');
      assert.equal(second.transitions, 47, 'one creation transition each, and no more');
    });
  });

  it('16. a rescheduled fixture reuses its original partition', async () => {
    await scenario(async (tx) => {
      await replay(tx);
      const before = await fixtureRow(tx, COMPLETED);

      const moved = capturedPageEvents('tournament_season_events_last', 0).map((event) =>
        String(event.id) === COMPLETED
          ? { ...event, startTimestamp: Math.floor(Date.UTC(2026, 9, 4, 19, 0) / 1000) }
          : event
      );
      await writeEvents(tx, moved, 'rescheduled-october');

      const after = await fixtureRow(tx, COMPLETED);
      assert.equal((await tally(tx)).fixtures, 47, 'no second fixture');
      assert.equal(after?.fixture_id, before?.fixture_id, 'the same row');
      assert.equal(after?.fixture_partition_on, before?.fixture_partition_on, 'the same partition');
      assert.equal(after?.scheduled_kickoff_at, '2026-10-04T19:00:00Z', 'the kickoff DID move');
    });
  });

  it('17. a reschedule across a year boundary stays physically in its 2026 partition', async () => {
    await scenario(async (tx) => {
      await replay(tx);
      const before = await fixtureRow(tx, COMPLETED);
      assert.equal(before?.physical_partition, 'football.fixture_p2026');

      const moved = capturedPageEvents('tournament_season_events_last', 0).map((event) =>
        String(event.id) === COMPLETED
          ? {
              ...event,
              startTimestamp: Math.floor(Date.UTC(2027, 2, 14, 15, 0) / 1000),
              status: { code: 0, description: 'Not started', type: 'notstarted' },
            }
          : event
      );
      await writeEvents(tx, moved, 'rescheduled-2027');

      const after = await fixtureRow(tx, COMPLETED);
      assert.equal((await tally(tx)).fixtures, 47);
      assert.equal(after?.fixture_id, before?.fixture_id);
      assert.equal(after?.fixture_partition_on, '2026-07-25', 'the original partition');
      assert.equal(after?.scheduled_kickoff_at, '2027-03-14T15:00:00Z');
      assert.equal(
        after?.physical_partition,
        'football.fixture_p2026',
        'physically still in 2026, not merely reporting a 2026 date'
      );
    });
  });

  it('18. an already-completed historical fixture gets no fabricated null → SCHEDULED', async () => {
    await scenario(async (tx) => {
      await replay(tx);
      const { rows } = await tx.query<{ from_state_code: string | null; to_state_code: string; n: string }>(
        `${SCOPE} SELECT t.from_state_code, t.to_state_code, count(*)::text AS n
           FROM football.fixture_lifecycle_transition t
          WHERE (t.fixture_id, t.fixture_partition_on)
                IN (SELECT id, fixture_partition_on FROM scoped_fixture)
          GROUP BY 1, 2`
      );
      const shapes = rows.map((row) => `${row.from_state_code ?? 'null'}→${row.to_state_code}:${row.n}`).sort();
      assert.deepEqual(
        shapes,
        ['null→COMPLETED:43', 'null→POSTPONED:4'],
        'every fixture arrived in the state it is in; none claims to have been SCHEDULED'
      );

      // And a re-sweep adds none.
      await replay(tx);
      assert.equal((await tally(tx)).transitions, 47);
    });
  });

  it('19. postponed → rescheduled follows the established transition', async () => {
    await scenario(async (tx) => {
      await replay(tx);

      // The four postponed fixtures reopen, at a date the provider has not yet
      // published — modelled here as the reschedule doc 39 §4 describes.
      const reopened = capturedPageEvents('tournament_season_events_last', 0).map((event) =>
        String(event.id) === POSTPONED
          ? {
              ...event,
              status: { code: 0, description: 'Not started', type: 'notstarted' },
              startTimestamp: Math.floor(Date.UTC(2026, 10, 12, 22, 0) / 1000),
            }
          : event
      );
      await writeEvents(tx, reopened, 'reopened');

      const { rows } = await tx.query<{ from_state_code: string | null; to_state_code: string }>(
        `SELECT t.from_state_code, t.to_state_code
           FROM football.fixture_lifecycle_transition t
           JOIN football.fixture f
             ON f.id = t.fixture_id AND f.fixture_partition_on = t.fixture_partition_on
          WHERE f.provider_external_id = $1
          ORDER BY t.transitioned_at, t.id`,
        [POSTPONED]
      );
      assert.deepEqual(
        rows.map((row) => `${row.from_state_code ?? 'null'}→${row.to_state_code}`),
        ['null→POSTPONED', 'POSTPONED→SCHEDULED'],
        'the whole postponement is legible, on one fixture'
      );
      assert.equal((await tally(tx)).fixtures, 47, 'reopening created no second fixture');
      const row = await fixtureRow(tx, POSTPONED);
      assert.equal(row?.fixture_partition_on, '2026-07-30', 'the abandoned date remains the partition');
    });
  });

  it('20. a duplicated provider identity across partitions is detected, not reconciled', async () => {
    await scenario(async (tx) => {
      await replay(tx);
      await tx.query(
        `INSERT INTO football.fixture
           (provider_code, provider_external_id, fixture_partition_on, competition_edition_id,
            home_team_id, away_team_id, scheduled_kickoff_at, lifecycle_state_code)
         SELECT provider_code, provider_external_id, DATE '2027-03-14', competition_edition_id,
                home_team_id, away_team_id, TIMESTAMPTZ '2027-03-14 15:00:00+00', lifecycle_state_code
           FROM football.fixture
          WHERE provider_code = $1 AND provider_external_id = $2`,
        [PROVIDER_CODE, COMPLETED]
      );

      await assert.rejects(
        () => findFixtureByProviderIdentity(tx, COMPLETED),
        (error: unknown) => {
          assert.ok(error instanceof AmbiguousFixtureIdentityError);
          assert.deepEqual(
            error.occurrences.map((row) => row.partitionOn),
            ['2026-07-25', '2027-03-14']
          );
          return true;
        }
      );
      assert.equal((await tally(tx)).fixtures, 48, 'and nothing was repaired');
    });
  });

  it('21. U-10 — an EARLIER reschedule still fails the CHECK, and is not swallowed', async () => {
    await scenario(async (tx) => {
      await replay(tx);
      const earlier = capturedPageEvents('tournament_season_events_last', 0).map((event) =>
        String(event.id) === COMPLETED
          ? { ...event, startTimestamp: Math.floor(Date.UTC(2026, 5, 1, 19, 0) / 1000) }
          : event
      );

      await assert.rejects(
        () => writeEvents(tx, earlier, 'rescheduled-earlier'),
        (error: unknown) => {
          const failure = error as { code?: string; constraint?: string };
          assert.equal(failure.code, '23514');
          assert.equal(failure.constraint, 'ck_fixture__partition_not_after_kickoff');
          return true;
        }
      );
    });
  });

  async function providerIds(tx: PoolClient): Promise<string[]> {
    const { rows } = await tx.query<{ provider_external_id: string }>(
      `${SCOPE} SELECT provider_external_id FROM scoped_fixture ORDER BY provider_external_id`
    );
    return rows.map((row) => row.provider_external_id);
  }
});
