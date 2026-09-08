// ─────────────────────────────────────────────────────────────────────────────
// READING FOOTBALL REALITY — Recent Venue Form CONTEXT (PD-11)
//
// A read-only CONTEXT surface for the V2 match page: for each participating team,
// its five most recent completed HOME fixtures and its five most recent completed
// AWAY fixtures, each enriched with opponent, venue and competition so the row
// stands on its own as a plain fact.
//
// ─────────────────────────────────────────────────────────────────────────────
// THIS IS CONTEXT, NOT A CALCULATION SUBSTRATE (PD-10 / PD-11)
//
// This read is DELIBERATELY SEPARATE from `readCompletedFixtures` (the bounded
// preparedness substrate consumed by calculators) and from `readEditionVenueResults`
// (the edition-cumulative population `home_away_split` consumes). It creates no
// feature, no module reading, and no last-5 calculation. It never feeds a
// calculator. Nothing here changes `home_away_split`, `readiness_tracker`, or any
// feature window; those reads are untouched. The last-5 venue grid is descriptive
// context a user reads — it is NOT the substrate of any module.
//
// ─────────────────────────────────────────────────────────────────────────────
// TEMPORAL SAFETY — STRICT `scheduled_kickoff_at < asOf` (PD-7)
//
// The upper bound is strict, exactly as everywhere else in V2: at the KICKOFF
// snapshot point `asOf` equals the subject fixture's kickoff, so `<` (never `<=`)
// guarantees the subject fixture can never appear inside its own context, and no
// future fixture or post-kickoff result can leak in. Eligibility is decided in SQL
// from the passed `asOf` — never from wall-clock `now`.
//
// Goals are oriented to the SUBJECT team (`goalsFor` = what this team scored),
// exactly as the other reality reads orient them.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

/** Five most recent per venue side (PD-11). */
export const RECENT_VENUE_FORM_PER_SIDE = 5;

/** One completed fixture in a team's recent venue form, oriented to that team. */
export interface RecentVenueFormRow {
  readonly fixtureId: string;
  readonly kickoffAt: Date;
  readonly isHome: boolean;
  /** null when the completed fixture has no persisted result row. */
  readonly goalsFor: number | null;
  readonly goalsAgainst: number | null;
  readonly opponent: { readonly id: string; readonly name: string; readonly slug: string };
  /** null when the fixture has no venue recorded (neutral/unknown). */
  readonly venueName: string | null;
  readonly competition: { readonly id: string; readonly name: string; readonly slug: string };
}

/** A team's recent venue form, split by venue side. Each side holds at most five rows. */
export interface TeamRecentVenueForm {
  readonly lastHome: readonly RecentVenueFormRow[];
  readonly lastAway: readonly RecentVenueFormRow[];
}

interface Row {
  team_id: string;
  fixture_id: string;
  scheduled_kickoff_at: Date;
  is_home: boolean;
  goals_for: number | null;
  goals_against: number | null;
  opponent_id: string;
  opponent_name: string;
  opponent_slug: string;
  venue_name: string | null;
  competition_id: string;
  competition_name: string;
  competition_slug: string;
}

/**
 * Partitions a team's completed fixtures into the five most recent per venue side.
 *
 * PURE and deterministic — no I/O. Exported so the PD-11 selection semantics are
 * unit-testable without a database: sort by `(kickoffAt DESC, fixtureId DESC)`,
 * split by `isHome`, take the first `perSide` of each. Fewer than `perSide` yields
 * the available rows (never manufactured, never mixed across venue sides).
 */
export function selectRecentVenueForm(
  rows: readonly RecentVenueFormRow[],
  perSide: number = RECENT_VENUE_FORM_PER_SIDE
): TeamRecentVenueForm {
  const byRecency = [...rows].sort((a, b) => {
    const t = b.kickoffAt.getTime() - a.kickoffAt.getTime();
    if (t !== 0) return t;
    // Total order (R-2): break kickoff ties by fixture id, descending.
    return b.fixtureId.localeCompare(a.fixtureId, undefined, { numeric: true });
  });
  const lastHome = byRecency.filter((r) => r.isHome).slice(0, perSide);
  const lastAway = byRecency.filter((r) => !r.isHome).slice(0, perSide);
  return { lastHome, lastAway };
}

const SQL = `
  WITH subject AS (
    SELECT team_id FROM unnest($1::bigint[]) AS t(team_id)
  ),
  played AS (
    SELECT s.team_id,
           f.id                    AS fixture_id,
           f.fixture_partition_on,
           f.scheduled_kickoff_at,
           true                    AS is_home,
           r.home_goals            AS goals_for,
           r.away_goals            AS goals_against,
           f.away_team_id          AS opponent_id,
           f.venue_id,
           f.competition_edition_id
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
           f.home_team_id,
           f.venue_id,
           f.competition_edition_id
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
  SELECT ranked.team_id::text          AS team_id,
         ranked.fixture_id::text       AS fixture_id,
         ranked.scheduled_kickoff_at   AS scheduled_kickoff_at,
         ranked.is_home                AS is_home,
         ranked.goals_for              AS goals_for,
         ranked.goals_against          AS goals_against,
         opp.id::text                  AS opponent_id,
         opp.name                      AS opponent_name,
         opp.slug                      AS opponent_slug,
         v.name                        AS venue_name,
         c.id::text                    AS competition_id,
         c.name                        AS competition_name,
         c.slug                        AS competition_slug
    FROM ranked
    JOIN football.team opp              ON opp.id = ranked.opponent_id
    LEFT JOIN football.venue v          ON v.id = ranked.venue_id
    JOIN football.competition_edition e ON e.id = ranked.competition_edition_id
    JOIN football.competition c         ON c.id = e.competition_id
   WHERE ranked.rank_on_side <= $3
   ORDER BY ranked.team_id, ranked.is_home DESC, ranked.scheduled_kickoff_at DESC, ranked.fixture_id DESC
`;

/**
 * The five most recent completed HOME and AWAY fixtures per team, strictly before
 * `asOf`, enriched with opponent / venue / competition. Read-only, schema-qualified.
 * A team with no completed fixture before `asOf` is simply absent from the map.
 */
export async function readRecentVenueFormRows(
  tx: PoolClient,
  teamIds: readonly string[],
  asOf: Date,
  perSide: number = RECENT_VENUE_FORM_PER_SIDE
): Promise<Map<string, RecentVenueFormRow[]>> {
  const byTeam = new Map<string, RecentVenueFormRow[]>();
  if (teamIds.length === 0) return byTeam;

  const { rows } = await tx.query<Row>(SQL, [teamIds, asOf, perSide]);
  for (const row of rows) {
    let list = byTeam.get(row.team_id);
    if (!list) {
      list = [];
      byTeam.set(row.team_id, list);
    }
    list.push({
      fixtureId: row.fixture_id,
      kickoffAt: row.scheduled_kickoff_at,
      isHome: row.is_home,
      goalsFor: row.goals_for === null ? null : Number(row.goals_for),
      goalsAgainst: row.goals_against === null ? null : Number(row.goals_against),
      opponent: { id: row.opponent_id, name: row.opponent_name, slug: row.opponent_slug },
      venueName: row.venue_name ?? null,
      competition: { id: row.competition_id, name: row.competition_name, slug: row.competition_slug },
    });
  }
  return byTeam;
}
