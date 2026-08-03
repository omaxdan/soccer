// ─────────────────────────────────────────────────────────────────────────────
// READING FOOTBALL REALITY — venues and home grounds
//
// Travel needs coordinates for two places: where a side is based, and where it
// played. "Venues are shared, neutral venues exist, and travel calculation
// requires coordinates belonging to the place rather than to whoever plays there."
//
// ─────────────────────────────────────────────────────────────────────────────
// COORDINATES ARE RETURNED AS STRINGS
//
// `latitude numeric(8,6)` and `longitude numeric(9,6)` arrive from `pg` as
// strings, and are kept that way through the read layer. Only the haversine in
// `travelLoad.ts` parses them, and only for trigonometry that cannot be exact.
// Converting here would put a float in the shared context where any calculator
// could pick it up.
//
// A venue with no coordinates is simply absent from the map. `ck_venue__
// coordinates_paired` guarantees the pair is present or absent together, so a
// half-located venue cannot exist to be mishandled.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { VenueLocation } from '../calculators/types';

/**
 * Home venue per team, including teams with none.
 *
 * The null is retained rather than dropped so a caller can tell "this side has
 * no recorded home ground" from "this side was not asked about" — the same
 * distinction PD-07 draws between an absent fact and an unexamined one.
 */
export async function readHomeVenues(
  tx: PoolClient,
  teamIds: readonly string[]
): Promise<Map<string, string | null>> {
  const homeVenues = new Map<string, string | null>();
  if (teamIds.length === 0) return homeVenues;

  const { rows } = await tx.query<{ team_id: string; home_venue_id: string | null }>(
    `SELECT t.id::text AS team_id, t.home_venue_id::text
       FROM football.team t
      WHERE t.id = ANY($1::bigint[])
      ORDER BY t.id`,
    [teamIds]
  );
  for (const row of rows) homeVenues.set(row.team_id, row.home_venue_id);
  return homeVenues;
}

/**
 * Located venues, by id.
 *
 * Venues without coordinates are EXCLUDED rather than returned with nulls, so a
 * lookup miss means exactly one thing: no distance can be computed. LC-05
 * requires absence rather than a substituted value, and a map that cannot hold
 * a located-but-unlocatable venue makes the substitution unreachable.
 */
export async function readVenueLocations(
  tx: PoolClient,
  venueIds: readonly string[]
): Promise<Map<string, VenueLocation>> {
  const venues = new Map<string, VenueLocation>();
  if (venueIds.length === 0) return venues;

  const { rows } = await tx.query<{ id: string; latitude: string; longitude: string }>(
    `SELECT id::text, latitude::text, longitude::text
       FROM football.venue
      WHERE id = ANY($1::bigint[])
        AND latitude IS NOT NULL
        AND longitude IS NOT NULL
      ORDER BY id`,
    [venueIds]
  );
  for (const row of rows) {
    venues.set(row.id, { venueId: row.id, latitude: row.latitude, longitude: row.longitude });
  }
  return venues;
}
