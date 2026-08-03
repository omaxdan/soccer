// ─────────────────────────────────────────────────────────────────────────────
// READING FOOTBALL REALITY — squad availability
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠ NOT CURRENTLY CONSUMED BY ANY CALCULATOR. READ THIS BEFORE USING IT.
//
// Document 21 §2 listed `player_availability`, `player_registration` and
// `team_registration` as sources for `team.readiness_score`. The final ADR
// superseded that: readiness has EXACTLY TWO INPUTS, `team.rest_advantage` and
// `team.congestion_index`, both of them features. It therefore has no Layer 1
// source at all, and no calculator in S-5 reads availability.
//
// This module is retained because the approved implementation layout names it,
// and it is implemented properly rather than stubbed because a file that exists
// and does not work is worse than one that does not exist. It is deliberately
// imported by nothing.
//
// NO `feature_source` ROW CITES IT. Declaring a source for a relation no
// calculation reads would assert a dependency nobody has — the same reasoning
// that forbids a `feature_source` row for `squad_continuity` (R-1).
//
// If a future feature version reintroduces availability as an input, that is a
// governed registry change: a new `feature_version`, a new `feature_source`, and
// a new `feature_dependency` if it consumes features. Not an edit here.
//
// ─────────────────────────────────────────────────────────────────────────────
// CURRENT AVAILABILITY IS A QUERY OVER OPEN SPELLS, NEVER A STORED FLAG
//
// LC-11. The previous platform held injury state in two places written by the
// same process with nothing constraining them to agree; "the resolution is
// removal of one representation, not synchronisation of both."
//
// A spell is open at `as_of` when its `daterange` contains that date. Range
// containment is used rather than a comparison against a sentinel end date,
// because an unbounded upper endpoint is what "still unavailable" means.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

/** Squad availability for one team at one instant. */
export interface SquadAvailability {
  readonly teamId: string;
  /** Players registered to the team at `as_of`. */
  readonly registeredCount: number;
  /** Of those, players with an unavailability spell open at `as_of`. */
  readonly unavailableCount: number;
}

/**
 * Registered and unavailable player counts per team, at one instant.
 *
 * Both counts come from one statement so they describe the same moment — two
 * statements could straddle a concurrent ingestion write and report a squad
 * size from before a transfer with an injury list from after it.
 *
 * The `as_of` instant is reduced to a UTC date because both
 * `player_registration.registration_period` and
 * `player_availability.spell_period` are `daterange`. PD-08 requires the
 * derivation in UTC.
 */
export async function readSquadAvailability(
  tx: PoolClient,
  teamIds: readonly string[],
  asOf: Date
): Promise<Map<string, SquadAvailability>> {
  const availability = new Map<string, SquadAvailability>();
  if (teamIds.length === 0) return availability;

  const asOfDate = asOf.toISOString().slice(0, 10);

  const { rows } = await tx.query<{
    team_id: string;
    registered_count: string;
    unavailable_count: string;
  }>(
    `SELECT reg.team_id::text,
            count(*)::text AS registered_count,
            count(*) FILTER (
              WHERE EXISTS (
                SELECT 1
                  FROM football.player_availability pa
                 WHERE pa.player_id = reg.player_id
                   AND pa.spell_period @> $2::date
              )
            )::text AS unavailable_count
       FROM football.player_registration reg
      WHERE reg.team_id = ANY($1::bigint[])
        AND reg.registration_period @> $2::date
      GROUP BY reg.team_id
      ORDER BY reg.team_id`,
    [teamIds, asOfDate]
  );

  for (const row of rows) {
    availability.set(row.team_id, {
      teamId: row.team_id,
      registeredCount: Number(row.registered_count),
      unavailableCount: Number(row.unavailable_count),
    });
  }
  return availability;
}
