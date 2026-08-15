// ─────────────────────────────────────────────────────────────────────────────
// READING FOOTBALL REALITY — edition-cumulative completed results
//
// The COMPETITION_SCOPED counterpart to `readCompletedFixtures`, and DELIBERATELY
// SEPARATE from it. `readCompletedFixtures` is bounded — ten per side plus a
// 28-day congestion window — because the preparedness features it serves are
// about the recent past. This read is the opposite: EVERY completed fixture of a
// team WITHIN ONE COMPETITION EDITION, before `as_of`, with no rank cap and no
// time window. A venue-performance identity ("home fortress / road warrior")
// spans a campaign, not a fortnight.
//
// Keeping the two functions apart is what guarantees the bounded reads — and
// every existing feature that shares them — are provably unaffected by the scoped
// path (Gate C-ii, doc 77 §5).
//
// ─────────────────────────────────────────────────────────────────────────────
// STRICT `kickoff < as_of`, AND ONE EDITION
//
// The upper bound is strict for the same reason it is everywhere else: at the
// KICKOFF snapshot point `as_of` equals the generating fixture's kickoff, and a
// value must never see the fixture it is calculated for. The population is scoped
// to a single `competition_edition_id` — which encodes competition AND season —
// so a cup tie or a previous season cannot contaminate a league-campaign value
// (S-0 cup contamination; Gate C-i).
//
// Goals are oriented to the SUBJECT team, exactly as `readCompletedFixtures`
// orients them, so a calculator reading `fixturesByTeam` behaves identically
// whichever read populated it.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { CompletedFixture, TeamFixtureHistory } from '../calculators/types';

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
 * Completed fixtures for a set of teams within ONE competition edition, strictly
 * before one instant — the whole campaign to date, unbounded by rank or window.
 *
 * Returns the same `Map<teamId, TeamFixtureHistory>` shape as
 * `readCompletedFixtures`, most recent first, so a scoped calculator consumes it
 * through the identical `fixturesByTeam` contract. A team with no completed
 * fixture in the edition before `as_of` is simply absent from the map, which a
 * calculator reads as NO VALUE (PD-07) rather than zero.
 */
export async function readEditionVenueResults(
  tx: PoolClient,
  teamIds: readonly string[],
  competitionEditionId: string,
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
          AND f.competition_edition_id = $2
          AND f.scheduled_kickoff_at < $3
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
          AND f.competition_edition_id = $2
          AND f.scheduled_kickoff_at < $3
     )
     SELECT team_id::text,
            fixture_id::text,
            fixture_partition_on::text,
            scheduled_kickoff_at,
            is_home,
            goals_for,
            goals_against,
            venue_id::text
       FROM played
      ORDER BY team_id, scheduled_kickoff_at DESC, fixture_id DESC`,
    [teamIds, competitionEditionId, asOf]
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
