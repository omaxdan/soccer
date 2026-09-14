// ─────────────────────────────────────────────────────────────────────────────
// MATCH VENUE — read model (SQL + pure mapping), evidence-honest
//
// Projects a fixture's ACTUAL recorded venue from PERSISTED football state
// (`football.fixture` LEFT JOIN `football.venue`). Layers kept strictly distinct:
//
//   OBSERVED DB EVIDENCE  — the venue's stored facts (name, city, country,
//     coordinates, elevation, timezone, capacity, surface) and the fixture's
//     neutral-venue flag.
//   READ-MODEL SHAPING    — mapping stored columns to the wire shape and a
//     present/absent coverage flag. No arithmetic, no inference.
//   GOVERNED INTELLIGENCE — NONE. No home-advantage, travel, fatigue, risk or
//     any other calculation. isNeutralVenue is an OBSERVED fixture attribute,
//     never a derived conclusion.
//
// Governance rules enforced by construction:
//   • A fixture with no recorded venue yields venue: null and coverage 'absent' —
//     never a fabricated venue.
//   • Every nullable venue field stays null when the stored value is null; nothing
//     (coordinates, capacity, surface, city, country, timezone) is invented.
//   • isNeutralVenue comes directly from the stored fixture field.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';

// ── contract view types ─────────────────────────────────────────────────────────

export interface Venue {
  readonly id: string;
  readonly name: string;
  readonly city: string | null;
  readonly countryCode: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly elevationMetres: number | null;
  readonly timezoneName: string | null;
  readonly capacity: number | null;
  readonly surface: string | null;
}

export type VenueCoverageState = 'present' | 'absent';
export interface MatchVenueCoverage {
  readonly venue: VenueCoverageState;
  /** Marks the venue as observed provider evidence, not a derived conclusion. */
  readonly venueIsObserved: true;
}

export interface MatchVenue {
  readonly venue: Venue | null;
  readonly isNeutralVenue: boolean;
  readonly coverage: MatchVenueCoverage;
}

// ── raw row shape ─────────────────────────────────────────────────────────────────

export interface MatchVenueRow {
  is_neutral_venue: boolean;
  venue_id: string | null;
  name: string | null;
  city: string | null;
  country_code: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  elevation_metres: number | string | null;
  timezone_name: string | null;
  capacity: number | string | null;
  surface: string | null;
}

// ── pure mappers ─────────────────────────────────────────────────────────────────

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Map one fixture-venue row to the projection. The row is the fixture (always
 * present when the fixture exists); the venue columns are null when the fixture has
 * no recorded venue (LEFT JOIN miss or a null venue_id). Pure.
 */
export function mapMatchVenue(row: MatchVenueRow): MatchVenue {
  const hasVenue = row.venue_id !== null && row.venue_id !== undefined;
  const venue: Venue | null = hasVenue
    ? {
        id: row.venue_id as string,
        name: row.name as string,
        city: row.city,
        countryCode: row.country_code,
        latitude: num(row.latitude),
        longitude: num(row.longitude),
        elevationMetres: num(row.elevation_metres),
        timezoneName: row.timezone_name,
        capacity: num(row.capacity),
        surface: row.surface,
      }
    : null;
  return {
    venue,
    isNeutralVenue: row.is_neutral_venue === true,
    coverage: { venue: venue !== null ? 'present' : 'absent', venueIsObserved: true },
  };
}

// ── SQL (read-only) ──────────────────────────────────────────────────────────────

// The fixture row (for is_neutral_venue) LEFT JOINed to its venue. One row per
// fixture; the venue columns are null when the fixture has no recorded venue.
const MATCH_VENUE_SQL = `
  SELECT f.is_neutral_venue AS is_neutral_venue,
         v.id::text AS venue_id, v.name AS name, v.city AS city, v.country_code AS country_code,
         v.latitude AS latitude, v.longitude AS longitude, v.elevation_metres AS elevation_metres,
         v.timezone_name AS timezone_name, v.capacity AS capacity, v.surface AS surface
    FROM football.fixture f
    LEFT JOIN football.venue v ON v.id = f.venue_id
   WHERE f.id = $1::bigint
   LIMIT 1
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

export async function readMatchVenue(tx: PoolClient, fixtureId: string): Promise<MatchVenue> {
  const res = await tx.query<MatchVenueRow>(MATCH_VENUE_SQL, [fixtureId]);
  const row = res.rows[0];
  // The fixture existence is established by the handler's gate; if the fixture row is
  // somehow absent here, report an honest empty venue rather than fabricating one.
  if (!row) return { venue: null, isNeutralVenue: false, coverage: { venue: 'absent', venueIsObserved: true } };
  return mapMatchVenue(row);
}
