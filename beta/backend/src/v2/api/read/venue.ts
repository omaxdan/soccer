// ─────────────────────────────────────────────────────────────────────────────
// VENUE — entity read model (identity + geography + canonical home teams).
//
// The geospatial KEYSTONE: the canonical football.venue entity, plus the teams
// whose canonical home_venue_id points here. Observed Evidence/Context ONLY.
//
//   IDENTITY / GEOGRAPHY — venue id, name, city, country, coordinates, elevation,
//     timezone, capacity, surface: stored provider facts, passed through verbatim.
//   HOME TEAMS           — teams with home_venue_id = this venue (the canonical
//     relationship), NOT teams that merely played a match here.
//   NOT here             — no travel distance, no travel impact, no map calculation,
//     no governed reading, no prediction/probability. Geography stays evidence.
//
// Governance rules enforced by construction:
//   • Nullable geographic fields (city/country/coordinates/elevation/timezone/
//     capacity/surface) stay null when the stored value is null — never fabricated,
//     never inferred, never zero-filled.
//   • Coordinates are passed through as numbers; nothing is geocoded or invented.
//   • "Home team" is strictly the canonical home_venue_id relationship.
// ─────────────────────────────────────────────────────────────────────────────

import type { PoolClient } from 'pg';
import type { Venue } from './matchVenue';
import type { ApiTeamSummary } from '../contract';

// ── contract view types ─────────────────────────────────────────────────────────

export interface VenueCoverage {
  readonly venue: 'present' | 'absent';       // 'present' in a 200 (404 when the venue does not exist)
  readonly homeTeams: 'present' | 'absent';
}

export interface VenueDetail {
  readonly venue: Venue;
  readonly homeTeams: readonly ApiTeamSummary[];
  readonly coverage: VenueCoverage;
}

// ── raw row shapes ──────────────────────────────────────────────────────────────

export interface VenueRow {
  id: string;
  name: string;
  city: string | null;
  country_code: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  elevation_metres: number | string | null;
  timezone_name: string | null;
  capacity: number | string | null;
  surface: string | null;
}

export interface VenueTeamRow {
  id: string;
  name: string;
  slug: string;
  short_name: string | null;
  country_code: string | null;
}

// ── pure mappers ─────────────────────────────────────────────────────────────────

function num(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Map a stored venue row to the canonical venue identity/geography. Pure. */
export function mapVenue(r: VenueRow): Venue {
  return {
    id: r.id,
    name: r.name,
    city: r.city,
    countryCode: r.country_code,
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    elevationMetres: num(r.elevation_metres),
    timezoneName: r.timezone_name,
    capacity: num(r.capacity),
    surface: r.surface,
  };
}

/** Map a home-team row to the shared team summary. Pure. */
export function mapVenueTeam(r: VenueTeamRow): ApiTeamSummary {
  return { id: r.id, name: r.name, slug: r.slug, shortName: r.short_name, countryCode: r.country_code };
}

export function buildVenueCoverage(homeTeams: readonly ApiTeamSummary[]): VenueCoverage {
  return { venue: 'present', homeTeams: homeTeams.length > 0 ? 'present' : 'absent' };
}

// ── SQL (read-only) ──────────────────────────────────────────────────────────────

const VENUE_SQL = `
  SELECT v.id::text AS id, v.name AS name, v.city AS city, v.country_code AS country_code,
         v.latitude AS latitude, v.longitude AS longitude, v.elevation_metres AS elevation_metres,
         v.timezone_name AS timezone_name, v.capacity AS capacity, v.surface AS surface
    FROM football.venue v
   WHERE v.id = $1::bigint
   LIMIT 1
`;

// Teams whose CANONICAL home venue is this one (not teams that merely played here).
const VENUE_HOME_TEAMS_SQL = `
  SELECT t.id::text AS id, t.name AS name, t.slug AS slug,
         t.short_name AS short_name, t.country_code AS country_code
    FROM football.team t
   WHERE t.home_venue_id = $1::bigint
   ORDER BY t.name
`;

// ── DB read (assembles the pure pieces) ─────────────────────────────────────────

/** The venue entity + its canonical home teams, or null when the venue does not exist. */
export async function readVenue(tx: PoolClient, venueId: string): Promise<VenueDetail | null> {
  const vRes = await tx.query<VenueRow>(VENUE_SQL, [venueId]);
  if (vRes.rows.length === 0) return null;

  const teamRes = await tx.query<VenueTeamRow>(VENUE_HOME_TEAMS_SQL, [venueId]);
  const homeTeams = teamRes.rows.map(mapVenueTeam);
  return { venue: mapVenue(vRes.rows[0]), homeTeams, coverage: buildVenueCoverage(homeTeams) };
}
