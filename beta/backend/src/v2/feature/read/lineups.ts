// ─────────────────────────────────────────────────────────────────────────────
// READING FOOTBALL REALITY — starting XIs (selection-continuity substrate)
//
// The source read for `team.squad_stability` (doc 98). For each subject team it
// returns EVERY completed fixture strictly before `as_of`, annotated with that
// team's STARTER player ids. Player identity only — no position, no minutes.
//
// ─────────────────────────────────────────────────────────────────────────────
// EVERY COMPLETED FIXTURE, NOT ONLY THE ENRICHED ONES
//
// A completed fixture with no usable lineup is returned with an EMPTY starter
// array, deliberately: the continuity metric treats it as an ineligible,
// chain-breaking gap (doc 98 §7). Returning only enriched fixtures would hide the
// gap and let two eligible XIs look adjacent when a lineup-less fixture sat
// between them — the bridging the governance forbids. So the fixture is the JOIN
// driver and the lineup is a LEFT JOIN.
//
// ─────────────────────────────────────────────────────────────────────────────
// BOUNDED BY as_of, STRICTLY; TOTALLY ORDERED
//
// `scheduled_kickoff_at < $asOf` (never `<=`), the same leak-free rule the other
// reads apply and the calculator re-applies. Rows are ordered ascending
// `(scheduled_kickoff_at, fixture_id)` so adjacency in the returned sequence is
// the transition adjacency the metric requires.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { StartingLineupObservation, TeamStartingLineups } from '../calculators/types';

interface LineupRow {
  team_id: string;
  fixture_id: string;
  fixture_partition_on: string;
  scheduled_kickoff_at: Date;
  starters: string[] | null;
}

/**
 * Per-team starting XIs for every completed fixture strictly before `as_of`.
 *
 * The starter set is this team's `lineup_selection` rows with `is_starting =
 * true`, aggregated per fixture. A fixture whose team has no lineup (or no
 * starters) yields an empty array — an ineligible, chain-breaking observation,
 * never omitted. Ascending order gives the calculator its adjacency.
 */
export async function readStartingLineups(
  tx: PoolClient,
  teamIds: readonly string[],
  asOf: Date
): Promise<Map<string, TeamStartingLineups>> {
  const histories = new Map<string, TeamStartingLineups>();
  if (teamIds.length === 0) return histories;

  const { rows } = await tx.query<LineupRow>(
    `WITH subject AS (
       SELECT team_id FROM unnest($1::bigint[]) AS t(team_id)
     )
     SELECT s.team_id::text,
            f.id::text                 AS fixture_id,
            f.fixture_partition_on::text,
            f.scheduled_kickoff_at,
            COALESCE(
              array_agg(sel.player_id::text ORDER BY sel.player_id)
                FILTER (WHERE sel.is_starting AND sel.player_id IS NOT NULL),
              '{}'
            )                          AS starters
       FROM subject s
       JOIN football.fixture f
              ON (f.home_team_id = s.team_id OR f.away_team_id = s.team_id)
       LEFT JOIN football.lineup ln
              ON ln.fixture_id = f.id
             AND ln.fixture_partition_on = f.fixture_partition_on
             AND ln.team_id = s.team_id
       LEFT JOIN football.lineup_selection sel
              ON sel.lineup_id = ln.id
             AND sel.fixture_partition_on = ln.fixture_partition_on
      WHERE f.lifecycle_state_code = 'COMPLETED'
        AND f.scheduled_kickoff_at < $2
      GROUP BY s.team_id, f.id, f.fixture_partition_on, f.scheduled_kickoff_at
      ORDER BY s.team_id, f.scheduled_kickoff_at, f.id`,
    [teamIds, asOf]
  );

  for (const row of rows) {
    let history = histories.get(row.team_id);
    if (!history) {
      history = { teamId: row.team_id, fixtures: [] };
      histories.set(row.team_id, history);
    }
    const observation: StartingLineupObservation = {
      fixtureId: row.fixture_id,
      fixturePartitionOn: row.fixture_partition_on,
      kickoffAt: row.scheduled_kickoff_at,
      starterPlayerIds: row.starters ?? [],
    };
    (history.fixtures as StartingLineupObservation[]).push(observation);
  }

  return histories;
}
