// ─────────────────────────────────────────────────────────────────────────────
// STANDINGS
//
// "A club's position AS OF A DATE. APPEND-ONLY. The temporal qualifier is the
// entire point: the previous platform stored current standings only, which is
// why a separate point-in-time reconstruction mechanism had to be built for
// backtesting. Making standings temporal REMOVES that compensating mechanism
// from the system rather than reimplementing it (LC-18)."
//
// So there is no update path here and no way to write one: ingestion holds S and
// I on football.standing, the append guard of migration 015 is attached to it,
// and `uq_standing__edition_team_variant_asof` makes one row per team per day
// per variant. Yesterday's table stays exactly as it was recorded.
//
// THREE VARIANTS, NOT ONE. `ck_standing__variant_known` admits TOTAL, HOME and
// AWAY. V1 stored only the total table, which is why the Home/Away Split module
// had to derive home form from match history rather than read it.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import { IngestionCounts, insertAppendOnly } from '../write/index';
import { nonNegativeInt } from '../normalise';
import { logger } from '../../../utils/logger';

export type StandingVariant = 'TOTAL' | 'HOME' | 'AWAY';

export interface ProviderStandingRow {
  readonly teamId: string;
  readonly position: number;
  readonly played: number;
  readonly won: number;
  readonly drawn: number;
  readonly lost: number;
  readonly goalsFor: number;
  readonly goalsAgainst: number;
  readonly points: number;
}

/**
 * Records a league table as of a date.
 *
 * `ck_standing__counts_consistent` requires `played = won + drawn + lost`. A row
 * failing it is REJECTED HERE rather than sent to be refused, which is the one
 * deliberate exception to this subsystem's rule of letting PostgreSQL own
 * validity — and the reason is specific: a standings response is written as one
 * multi-row statement, so a single inconsistent row would abort the whole table.
 * Twenty valid rows lost to one bad one is a worse outcome than twenty written
 * and one counted as rejected.
 *
 * The constraint still runs. Nothing here replaces it; this only decides which
 * rows are offered, so the failure is per row instead of per table.
 */
export async function recordStandings(
  tx: PoolClient,
  editionId: string,
  variant: StandingVariant,
  asOfOn: string,
  table: readonly ProviderStandingRow[],
  counts: IngestionCounts
): Promise<void> {
  const rows: unknown[][] = [];

  for (const entry of table) {
    const played = nonNegativeInt(entry.played);
    const won = nonNegativeInt(entry.won);
    const drawn = nonNegativeInt(entry.drawn);
    const lost = nonNegativeInt(entry.lost);
    const goalsFor = nonNegativeInt(entry.goalsFor);
    const goalsAgainst = nonNegativeInt(entry.goalsAgainst);
    const points = nonNegativeInt(entry.points);

    if (
      played === null || won === null || drawn === null || lost === null ||
      goalsFor === null || goalsAgainst === null || points === null
    ) {
      counts.reject('standing row has a missing or negative count');
      continue;
    }
    if (played !== won + drawn + lost) {
      counts.reject('standing row fails played = won + drawn + lost');
      logger.warn(
        { edition: editionId, team: entry.teamId, played, won, drawn, lost },
        'v2 ingestion: inconsistent standing row rejected, remainder of the table still written'
      );
      continue;
    }

    rows.push([
      editionId, entry.teamId, variant, asOfOn, entry.position,
      played, won, drawn, lost, goalsFor, goalsAgainst, points,
    ]);
  }

  const result = await insertAppendOnly(tx, {
    relation: 'football.standing',
    columns: [
      'competition_edition_id', 'team_id', 'standing_variant', 'as_of_on', 'position',
      'played', 'won', 'drawn', 'lost', 'goals_for', 'goals_against', 'points',
    ],
    rows,
    conflictTarget: ['competition_edition_id', 'team_id', 'standing_variant', 'as_of_on'],
  });
  counts.add(result);
}
