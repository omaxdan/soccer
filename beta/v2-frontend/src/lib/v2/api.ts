// V2 API CLIENT (server-side). The V2 UI's single door to persisted V2 data:
// it fetches the B.2/B.3 HTTP API. No database, no V1 query helper, no writes.
// Called from server components, so requests are server-to-server (no CORS) and
// never expose a credential to the browser. Base URL is configurable.

import type {
  MatchDetailResponse, MatchIntelligenceResponse, EditionFixtureListResponse, EditionListResponse, EditionStandingsResponse,
  TeamListResponse, TeamDetailResponse, PlayerListResponse, PlayerDetailResponse,
  CompetitionResponse, CountryResponse, VenueResponse,
  TeamPerformanceResponse, TeamReadinessResponse, TeamGovernedIntelligenceResponse, TeamAttributesResponse, FixturesByDateResponse,
  MatchResultResponse, MatchLineupsResponse, MatchTeamStatisticsResponse,
  MatchLifecycleResponse, MatchVenueResponse,
} from './types';

export const V2_API_BASE =
  process.env.PITCHTERMINAL_V2_API ??
  process.env.NEXT_PUBLIC_PITCHTERMINAL_V2_API ??
  'http://127.0.0.1:8787';

export class V2ApiError extends Error {
  constructor(readonly status: number, readonly path: string) {
    super(`V2 API ${status} for ${path}`);
    this.name = 'V2ApiError';
  }
}

async function getJson<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${V2_API_BASE}${path}`, { cache: 'no-store', headers: { accept: 'application/json' } });
  } catch {
    throw new V2ApiError(0, path); // network / unreachable
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new V2ApiError(res.status, path);
  return (await res.json()) as T;
}

/** Editions with materialized fixtures — the league entry list. Never 404s. */
export async function fetchEditions(): Promise<EditionListResponse> {
  const body = await getJson<EditionListResponse>('/api/v2/editions');
  return body ?? { editions: [] };
}

/** One edition's fixtures, or null when the edition does not exist. */
export function fetchEditionFixtures(editionId: string): Promise<EditionFixtureListResponse | null> {
  return getJson<EditionFixtureListResponse>(`/api/v2/editions/${encodeURIComponent(editionId)}/fixtures`);
}

/** One edition's governed standings snapshot (TOTAL/HOME/AWAY tables), or null when the
 *  edition is not a governed-exposed edition. Observed snapshot — never client-computed. */
export function fetchEditionStandings(editionId: string): Promise<EditionStandingsResponse | null> {
  return getJson<EditionStandingsResponse>(`/api/v2/editions/${encodeURIComponent(editionId)}/standings`);
}

/** One match's detail, or null when the fixture does not exist. */
export function fetchMatch(matchId: string): Promise<MatchDetailResponse | null> {
  return getJson<MatchDetailResponse>(`/api/v2/matches/${encodeURIComponent(matchId)}`);
}

/**
 * A fixture's SEALED Match Intelligence + its live context, or null when the
 * fixture has no sealed snapshot (the endpoint is sealed-only for `intelligence`
 * and 404s otherwise). A null here does NOT prove the fixture is absent — the page
 * distinguishes "unsealed" from "no such fixture" by falling back to fetchMatch.
 */
export function fetchMatchIntelligence(matchId: string): Promise<MatchIntelligenceResponse | null> {
  return getJson<MatchIntelligenceResponse>(`/api/v2/matches/${encodeURIComponent(matchId)}/intelligence`);
}

/** A fixture's observed result (final/HT/ET/pens), or null when the fixture is absent. */
export function fetchMatchResult(matchId: string): Promise<MatchResultResponse | null> {
  return getJson<MatchResultResponse>(`/api/v2/matches/${encodeURIComponent(matchId)}/result`);
}

/** A fixture's observed lineups (XI/bench/formation), or null when the fixture is absent. */
export function fetchMatchLineups(matchId: string): Promise<MatchLineupsResponse | null> {
  return getJson<MatchLineupsResponse>(`/api/v2/matches/${encodeURIComponent(matchId)}/lineups`);
}

/** A fixture's observed team statistics per period, or null when the fixture is absent. */
export function fetchMatchTeamStatistics(matchId: string): Promise<MatchTeamStatisticsResponse | null> {
  return getJson<MatchTeamStatisticsResponse>(`/api/v2/matches/${encodeURIComponent(matchId)}/team-statistics`);
}

/** A fixture's observed lifecycle transitions, or null when the fixture is absent. */
export function fetchMatchLifecycle(matchId: string): Promise<MatchLifecycleResponse | null> {
  return getJson<MatchLifecycleResponse>(`/api/v2/matches/${encodeURIComponent(matchId)}/lifecycle`);
}

/** A fixture's observed venue + neutral flag, or null when the fixture is absent. */
export function fetchMatchVenue(matchId: string): Promise<MatchVenueResponse | null> {
  return getJson<MatchVenueResponse>(`/api/v2/matches/${encodeURIComponent(matchId)}/venue`);
}

/** Teams in the governed authorized-active edition(s). Never 404s. */
/** Fixture calendar for a UTC date (YYYY-MM-DD). Returns a 200 body even when empty;
 *  null only on a network/HTTP failure per getJson's convention. */
export function fetchFixturesByDate(date: string): Promise<FixturesByDateResponse | null> {
  return getJson<FixturesByDateResponse>(`/api/v2/fixtures/${encodeURIComponent(date)}`);
}

export async function fetchTeams(): Promise<TeamListResponse> {
  const body = await getJson<TeamListResponse>('/api/v2/teams');
  return body ?? { teams: [] };
}

/** One team's identity/context, or null when not exposed under a governed edition. */
export function fetchTeam(teamId: string): Promise<TeamDetailResponse | null> {
  return getJson<TeamDetailResponse>(`/api/v2/teams/${encodeURIComponent(teamId)}`);
}

/** A team's DESCRIPTIVE performance evidence (persisted features), or null when the
 *  team is not exposed under a governed edition. NOT governed intelligence. */
export function fetchTeamPerformance(teamId: string): Promise<TeamPerformanceResponse | null> {
  return getJson<TeamPerformanceResponse>(`/api/v2/teams/${encodeURIComponent(teamId)}/performance`);
}

/** A team's GOVERNED readiness reading (readiness_tracker), or null when the team is
 *  not exposed under a governed edition. */
export function fetchTeamReadiness(teamId: string): Promise<TeamReadinessResponse | null> {
  return getJson<TeamReadinessResponse>(`/api/v2/teams/${encodeURIComponent(teamId)}/readiness`);
}

/** A team's GOVERNED home_away_split (per edition) + consistency_index readings, or null
 *  when the team is not exposed under a governed edition. Governed module readings only. */
export function fetchTeamGovernedIntelligence(teamId: string): Promise<TeamGovernedIntelligenceResponse | null> {
  return getJson<TeamGovernedIntelligenceResponse>(`/api/v2/teams/${encodeURIComponent(teamId)}/intelligence`);
}

export function fetchTeamAttributes(teamId: string): Promise<TeamAttributesResponse | null> {
  return getJson<TeamAttributesResponse>(`/api/v2/teams/${encodeURIComponent(teamId)}/attributes`);
}

/** Players in the governed authorized-active edition(s). Never 404s. */
export async function fetchPlayers(): Promise<PlayerListResponse> {
  const body = await getJson<PlayerListResponse>('/api/v2/players');
  return body ?? { players: [] };
}

/** One player's biography/context, or null when not in a governed edition squad. */
export function fetchPlayer(playerId: string): Promise<PlayerDetailResponse | null> {
  return getJson<PlayerDetailResponse>(`/api/v2/players/${encodeURIComponent(playerId)}`);
}

/** One competition's identity + governed editions, or null when unknown/unauthorized.
 *  Addressed by the numeric DB id (the trailing id parsed from the public slug). */
export function fetchCompetition(competitionId: string): Promise<CompetitionResponse | null> {
  return getJson<CompetitionResponse>(`/api/v2/competitions/${encodeURIComponent(competitionId)}`);
}

/** One country's identity + governed members, or null when the ISO code is unknown.
 *  Addressed by the ISO alpha-2 code. */
export function fetchCountry(countryCode: string): Promise<CountryResponse | null> {
  return getJson<CountryResponse>(`/api/v2/countries/${encodeURIComponent(countryCode)}`);
}

/** One venue's identity/geography + canonical home teams, or null when unknown.
 *  Addressed by the numeric DB id (the trailing id parsed from the public slug). */
export function fetchVenue(venueId: string): Promise<VenueResponse | null> {
  return getJson<VenueResponse>(`/api/v2/venues/${encodeURIComponent(venueId)}`);
}
