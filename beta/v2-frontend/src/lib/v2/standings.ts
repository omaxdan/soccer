// STANDINGS — pure lookup helper (DB-free, no calculation).
//
// Selects ONE team's row from the governed edition standings snapshot. It computes
// nothing — position/points/etc. are read verbatim from the backend read. Matching is
// by the canonical team id (never by name, never "first row").

import type { EditionStandings, StandingLine } from './types';

/** The team's TOTAL-variant standing row, or null when standings are absent or the
 *  team has no row in the snapshot. Matches on team.id (canonical), not position. */
export function findTeamStanding(standings: EditionStandings, teamId: string): StandingLine | null {
  if (standings.coverage.standings === 'absent') return null;
  const table = standings.tables.find((t) => t.variant === 'TOTAL') ?? standings.tables[0] ?? null;
  if (!table) return null;
  return table.rows.find((r) => r.team.id === teamId) ?? null;
}
