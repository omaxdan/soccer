// ─────────────────────────────────────────────────────────────────────────────
// READING FOOTBALL REALITY — edition-wide fixtures for rank reconstruction
//
// S-6 Phase 3B. The Giant Killer feature needs each opponent's league rank AT the
// pre-match snapshot, which no per-team read can supply: rank is a property of ALL
// teams in an edition, not of one team's own results. This read returns EVERY
// completed fixture (with a result) in the editions the subject teams played,
// which `calculators/giantKillerRanking.ts` then replays into rank bands.
//
// DELIBERATELY DISTINCT from the subject-oriented reads:
//   readCompletedFixtures ......... last-N-per-side + 28-day window, one team
//   readCompletedFixturesInWindow . full 730-day history, one team (Phase 2)
//   readEditionVenueResults ....... whole edition, but still ONE team's fixtures
// None of those carries the opposing teams' results needed to rank an opponent.
// The Phase-2 long-window read is untouched by this file (it is not modified or
// reused — it cannot reconstruct standings, being subject-oriented).
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO-STEP, AND WHY THE REPLAY IS NOT WINDOW-BOUNDED
//
// 1. Find the editions in which a subject team has a completed fixture within the
//    730-day window before `as_of`. Only these editions can contribute to a
//    Giant Killer value, so only these are replayed.
// 2. Read EVERY completed fixture (all teams) in those editions with kickoff
//    STRICTLY before `as_of` — NOT lower-bounded by the 730-day window. A fixture
//    within the window is ranked against the standings accumulated from the
//    edition's start, which may include fixtures older than the window. The
//    730-day lower bound belongs to the FEATURE's PPG stream (applied in the
//    calculator), never to the standings replay.
//
// STRICT `kickoff < as_of`: the leak rule applied everywhere. At the KICKOFF
// snapshot `as_of` equals the generating fixture's kickoff, so `<=` would admit
// the fixture being calculated for. The target fixture (e.g. 337) is excluded
// both by the strict bound and by being SCHEDULED, not COMPLETED.
//
// INNER JOIN football.result: a completed fixture without a result awards no
// points and must not advance standings, so it is excluded from the replay.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { EditionFixture } from '../calculators/giantKillerRanking';

/** The Giant Killer window, in days (V1 MAX_WINDOW_DAYS). */
export const RANKING_WINDOW_DAYS = 730;

interface EditionFixtureRow {
  competition_edition_id: string;
  fixture_id: string;
  fixture_partition_on: string;
  scheduled_kickoff_at: Date;
  home_team_id: string;
  away_team_id: string;
  home_goals: number;
  away_goals: number;
}

/**
 * Every completed-with-result fixture, all teams, in the editions the subject
 * teams played within the 730-day window before `as_of`, with kickoff strictly
 * before `as_of` — ordered `(edition, kickoff, fixture_id)` so the replay is
 * deterministic. Returned flat; `rankEditionFixtures` groups by edition.
 */
export async function readEditionRankingFixtures(
  tx: PoolClient,
  teamIds: readonly string[],
  asOf: Date,
  windowDays: number = RANKING_WINDOW_DAYS
): Promise<EditionFixture[]> {
  if (teamIds.length === 0) return [];

  const { rows } = await tx.query<EditionFixtureRow>(
    `WITH windowed_editions AS (
       SELECT DISTINCT f.competition_edition_id
         FROM football.fixture f
         JOIN football.result r
               ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
        WHERE f.lifecycle_state_code = 'COMPLETED'
          AND (f.home_team_id = ANY($1::bigint[]) OR f.away_team_id = ANY($1::bigint[]))
          AND f.scheduled_kickoff_at <  $2
          AND f.scheduled_kickoff_at >= $2::timestamptz - make_interval(days => $3::int)
     )
     SELECT f.competition_edition_id::text AS competition_edition_id,
            f.id::text                     AS fixture_id,
            f.fixture_partition_on::text   AS fixture_partition_on,
            f.scheduled_kickoff_at,
            f.home_team_id::text           AS home_team_id,
            f.away_team_id::text           AS away_team_id,
            r.home_goals,
            r.away_goals
       FROM football.fixture f
       JOIN football.result r
             ON r.fixture_id = f.id AND r.fixture_partition_on = f.fixture_partition_on
      WHERE f.competition_edition_id IN (SELECT competition_edition_id FROM windowed_editions)
        AND f.lifecycle_state_code = 'COMPLETED'
        AND f.scheduled_kickoff_at < $2
      ORDER BY f.competition_edition_id, f.scheduled_kickoff_at, f.id`,
    [teamIds, asOf, windowDays]
  );

  return rows.map((row) => ({
    competitionEditionId: row.competition_edition_id,
    fixtureId: row.fixture_id,
    fixturePartitionOn: row.fixture_partition_on,
    kickoffAt: row.scheduled_kickoff_at,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    homeGoals: row.home_goals,
    awayGoals: row.away_goals,
  }));
}
