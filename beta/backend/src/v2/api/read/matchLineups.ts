// ─────────────────────────────────────────────────────────────────────────────
// MATCH LINEUPS — read model (SQL + pure aggregation), evidence-honest
//
// Projects a fixture's ACTUAL reported lineups from PERSISTED football state
// (`football.lineup` + `football.lineup_selection`). Three layers kept distinct:
//
//   OBSERVED DB EVIDENCE  — the reported lineup: formation, and each selected
//     player with position, shirt number, and starting/bench flag.
//   READ-MODEL SHAPING    — grouping selections into starting XI vs substitutes,
//     ordered deterministically. No arithmetic, no inference.
//   GOVERNED INTELLIGENCE — NONE. This is the ACTUAL lineup as reported, NEVER a
//     predicted XI. Predicted lineups are a Layer-2 calculated artefact (LC-15)
//     and are deliberately not produced or implied here.
//
// Governance rules enforced by construction:
//   • Only what was reported is surfaced. A team with no reported lineup yields a
//     null lineup (a visible coverage fact), never a fabricated XI.
//   • position/shirt are passed through as stored (nullable); absence stays null.
//   • Team identity comes from the fixture header (canonical), not re-derived.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

// ── contract view types ─────────────────────────────────────────────────────────

export interface LineupPlayer {
  readonly player: { readonly id: string; readonly fullName: string; readonly slug: string };
  readonly positionCode: string | null;
  readonly positionName: string | null;   // football.position.display_name, when the code resolves
  readonly positionGroup: string | null;   // football.position.position_group
  readonly shirtNumber: number | null;
}

export interface TeamLineup {
  readonly team: { readonly id: string; readonly name: string; readonly slug: string };
  readonly formation: string | null;       // stated once per club per fixture; null when not reported
  readonly starting: readonly LineupPlayer[];
  readonly substitutes: readonly LineupPlayer[];
}

export type LineupCoverageState = 'present' | 'absent';
export interface MatchLineupsCoverage {
  readonly lineups: LineupCoverageState;
  /** Marks these as ACTUAL reported lineups — never a predicted/derived XI. */
  readonly lineupsAreObserved: true;
}

export interface MatchLineups {
  readonly home: TeamLineup | null;
  readonly away: TeamLineup | null;
  readonly coverage: MatchLineupsCoverage;
}

/** Minimal team identity carried from the fixture header. */
export interface TeamRef { readonly id: string; readonly name: string; readonly slug: string }

// ── raw row shape ─────────────────────────────────────────────────────────────────

export interface LineupSelectionRow {
  team_id: string;
  formation: string | null;
  player_id: string;
  player_full_name: string;
  player_slug: string;
  position_code: string | null;
  position_name: string | null;
  position_group: string | null;
  shirt_number: number | string | null;
  is_starting: boolean;
}

// ── pure mappers/aggregation ───────────────────────────────────────────────────

export function mapLineupPlayer(r: LineupSelectionRow): LineupPlayer {
  return {
    player: { id: r.player_id, fullName: r.player_full_name, slug: r.player_slug },
    positionCode: r.position_code,
    positionName: r.position_name,
    positionGroup: r.position_group,
    shirtNumber: r.shirt_number === null || r.shirt_number === undefined ? null : Number(r.shirt_number),
  };
}

/** Order within a group: shirt number ascending (nulls last), then full name. Pure. */
function orderSelections(rows: readonly LineupSelectionRow[]): LineupSelectionRow[] {
  return [...rows].sort((a, b) => {
    const sa = a.shirt_number === null || a.shirt_number === undefined ? Number.POSITIVE_INFINITY : Number(a.shirt_number);
    const sb = b.shirt_number === null || b.shirt_number === undefined ? Number.POSITIVE_INFINITY : Number(b.shirt_number);
    return sa - sb || a.player_full_name.localeCompare(b.player_full_name);
  });
}

/** Build one team's lineup from its selection rows, or null when it has none. */
export function buildTeamLineup(team: TeamRef, rows: readonly LineupSelectionRow[]): TeamLineup | null {
  const mine = rows.filter((r) => r.team_id === team.id);
  if (mine.length === 0) return null;
  const starting = orderSelections(mine.filter((r) => r.is_starting)).map(mapLineupPlayer);
  const substitutes = orderSelections(mine.filter((r) => !r.is_starting)).map(mapLineupPlayer);
  // Formation is stated once per club; take the first non-null seen for this team.
  const formation = mine.find((r) => r.formation !== null && r.formation !== undefined)?.formation ?? null;
  return { team, formation, starting, substitutes };
}

/**
 * Group selection rows into home/away lineups, oriented by the fixture header's team
 * identities. A team with no reported selections yields a null lineup — never a
 * fabricated XI. Pure and deterministic.
 */
export function groupMatchLineups(rows: readonly LineupSelectionRow[], home: TeamRef, away: TeamRef): MatchLineups {
  const homeLineup = buildTeamLineup(home, rows);
  const awayLineup = buildTeamLineup(away, rows);
  return {
    home: homeLineup,
    away: awayLineup,
    coverage: {
      lineups: homeLineup !== null || awayLineup !== null ? 'present' : 'absent',
      lineupsAreObserved: true,
    },
  };
}

// ── SQL (read-only) ──────────────────────────────────────────────────────────────

const MATCH_LINEUPS_SQL = `
  SELECT l.team_id::text AS team_id, l.formation AS formation,
         ls.player_id::text AS player_id, p.full_name AS player_full_name, p.slug AS player_slug,
         ls.position_code AS position_code,
         pos.display_name AS position_name, pos.position_group AS position_group,
         ls.shirt_number AS shirt_number, ls.is_starting AS is_starting
    FROM football.lineup l
    JOIN football.lineup_selection ls
      ON ls.lineup_id = l.id AND ls.fixture_partition_on = l.fixture_partition_on
    JOIN football.player p ON p.id = ls.player_id
    LEFT JOIN football.position pos ON pos.code = ls.position_code
   WHERE l.fixture_id = $1::bigint
   ORDER BY l.team_id, ls.is_starting DESC, ls.shirt_number NULLS LAST, p.full_name
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

export async function readMatchLineups(tx: PoolClient, fixtureId: string, home: TeamRef, away: TeamRef): Promise<MatchLineups> {
  const res = await tx.query<LineupSelectionRow>(MATCH_LINEUPS_SQL, [fixtureId]);
  return groupMatchLineups(res.rows, home, away);
}
