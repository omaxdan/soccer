// ─────────────────────────────────────────────────────────────────────────────
// READING FOOTBALL REALITY — completed fixtures
//
// ─────────────────────────────────────────────────────────────────────────────
// EVERY WINDOW IS BOUNDED BY as_of, STRICTLY
//
// `scheduled_kickoff_at < $asOf`. Never `<=`. At the KICKOFF snapshot point
// `as_of` equals the generating fixture's kickoff, so `<=` would let a value see
// the fixture it is being calculated for — and once that fixture is COMPLETED it
// would see the result. "A feature that saw a fixture's result before the
// fixture was played measures nothing."
//
// The bound is applied HERE, in SQL, as well as in `before()` inside the
// calculators. Two independent applications of one rule: the reader cannot hand
// a calculator a fixture it must not see, and a calculator that received one
// anyway would still exclude it.
//
// ─────────────────────────────────────────────────────────────────────────────
// TOTAL ORDER BY (R-2 obligation 1)
//
// Every query here orders by `(team_id, scheduled_kickoff_at DESC, fixture_id
// DESC)`. Kickoff alone is not total — two fixtures can share an instant — and
// an unordered read may return rows in any order, which would make a windowed
// aggregation produce a different result on a different run.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY ONE BATCH IS ONE `as_of`
//
// "Last ten completed home fixtures before `as_of`" is only well defined for a
// single instant. Batching subjects that share an `as_of` makes the ranking
// exact in SQL; mixing instants would force either an over-read with per-subject
// re-filtering or a lookback horizon nobody can justify.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { CompletedFixture, TeamFixtureHistory } from '../calculators/types';

/**
 * Fixtures per side retained.
 *
 * Ten satisfies `team.home_form` and `team.away_form` (ten per side) and
 * `team.travel_impact` (five away). `team.rest_advantage` needs the single most
 * recent, which is necessarily within the ten of whichever side it fell on.
 *
 * `team.congestion_index` is NOT covered by this rank — a busy month can hold
 * more than ten fixtures on one side — so the query unions a separate
 * time-bounded branch for it. Deriving the congestion window from a rank would
 * silently undercount exactly the congested sides the feature exists to find.
 */
const FIXTURES_PER_SIDE = 10;

/** The congestion window, in days. Matches `fixtureLoad`'s 28-day backward window. */
const CONGESTION_WINDOW_DAYS = 28;

interface FixtureRow {
  team_id: string;
  fixture_id: string;
  fixture_partition_on: string;
  scheduled_kickoff_at: Date;
  is_home: boolean;
  goals_for: number | null;
  goals_against: number | null;
  venue_id: string | null;
}

/**
 * Completed fixtures for a set of teams, strictly before one instant.
 *
 * Returns, per team, the union of:
 *   - the most recent `FIXTURES_PER_SIDE` home fixtures
 *   - the most recent `FIXTURES_PER_SIDE` away fixtures
 *   - every fixture within the congestion window
 *
 * Goals are oriented to the SUBJECT team — `goals_for` is what this team scored,
 * whichever side it played on. Orienting in SQL keeps four calculators from each
 * re-deriving it, which is where a home/away inversion would eventually creep in.
 *
 * A fixture with no `football.result` row yields null goals. It is still
 * returned, because congestion counts fixtures played and does not care about
 * the score; form filters those rows out itself.
 */
export async function readCompletedFixtures(
  tx: PoolClient,
  teamIds: readonly string[],
  asOf: Date
): Promise<Map<string, TeamFixtureHistory>> {
  const histories = new Map<string, TeamFixtureHistory>();
  if (teamIds.length === 0) return histories;

  const { rows } = await tx.query<FixtureRow>(
    `WITH subject AS (
       SELECT team_id FROM unnest($1::bigint[]) AS t(team_id)
     ),
     played AS (
       SELECT s.team_id,
              f.id                   AS fixture_id,
              f.fixture_partition_on,
              f.scheduled_kickoff_at,
              true                   AS is_home,
              r.home_goals           AS goals_for,
              r.away_goals           AS goals_against,
              f.venue_id
         FROM subject s
         JOIN football.fixture f ON f.home_team_id = s.team_id
         LEFT JOIN football.result r
                ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
        WHERE f.lifecycle_state_code = 'COMPLETED'
          AND f.scheduled_kickoff_at < $2
       UNION ALL
       SELECT s.team_id,
              f.id,
              f.fixture_partition_on,
              f.scheduled_kickoff_at,
              false,
              r.away_goals,
              r.home_goals,
              f.venue_id
         FROM subject s
         JOIN football.fixture f ON f.away_team_id = s.team_id
         LEFT JOIN football.result r
                ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
        WHERE f.lifecycle_state_code = 'COMPLETED'
          AND f.scheduled_kickoff_at < $2
     ),
     ranked AS (
       SELECT played.*,
              row_number() OVER (
                PARTITION BY team_id, is_home
                ORDER BY scheduled_kickoff_at DESC, fixture_id DESC
              ) AS rank_on_side
         FROM played
     )
     SELECT team_id::text,
            fixture_id::text,
            fixture_partition_on::text,
            scheduled_kickoff_at,
            is_home,
            goals_for,
            goals_against,
            venue_id::text
       FROM ranked
      WHERE rank_on_side <= $3
         OR scheduled_kickoff_at >= $2::timestamptz - make_interval(days => $4::int)
      ORDER BY team_id, scheduled_kickoff_at DESC, fixture_id DESC`,
    [teamIds, asOf, FIXTURES_PER_SIDE, CONGESTION_WINDOW_DAYS]
  );

  for (const row of rows) {
    let history = histories.get(row.team_id);
    if (!history) {
      history = { teamId: row.team_id, fixtures: [] };
      histories.set(row.team_id, history);
    }
    const fixture: CompletedFixture = {
      fixtureId: row.fixture_id,
      fixturePartitionOn: row.fixture_partition_on,
      kickoffAt: row.scheduled_kickoff_at,
      isHome: row.is_home,
      goalsFor: row.goals_for,
      goalsAgainst: row.goals_against,
      venueId: row.venue_id,
    };
    (history.fixtures as CompletedFixture[]).push(fixture);
  }

  return histories;
}

/**
 * Fixtures eligible to generate `as_of` instants, for the driver.
 *
 * Returns SCHEDULED and COMPLETED fixtures alike: a snapshot point is a moment
 * before kickoff, and a fixture that has since been played still had a T-7d.
 * Cancelled, postponed and abandoned fixtures are excluded — a moment before a
 * match that never happened describes nothing a consumer will ask for.
 */
export async function readFixturesForEligibility(
  tx: PoolClient,
  fromKickoff: Date,
  toKickoff: Date
): Promise<
  { fixtureId: string; kickoffAt: Date; homeTeamId: string; awayTeamId: string }[]
> {
  const { rows } = await tx.query<{
    fixture_id: string;
    scheduled_kickoff_at: Date;
    home_team_id: string;
    away_team_id: string;
  }>(
    `SELECT id::text AS fixture_id,
            scheduled_kickoff_at,
            home_team_id::text,
            away_team_id::text
       FROM football.fixture
      WHERE lifecycle_state_code IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED')
        AND scheduled_kickoff_at >= $1
        AND scheduled_kickoff_at <= $2
      ORDER BY scheduled_kickoff_at, id`,
    [fromKickoff, toKickoff]
  );
  return rows.map((row) => ({
    fixtureId: row.fixture_id,
    kickoffAt: row.scheduled_kickoff_at,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
  }));
}
