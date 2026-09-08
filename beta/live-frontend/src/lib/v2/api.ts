// V2 API CLIENT (server-side). The V2 UI's single door to persisted V2 data:
// it fetches the B.2/B.3 HTTP API. No database, no V1 query helper, no writes.
// Called from server components, so requests are server-to-server (no CORS) and
// never expose a credential to the browser. Base URL is configurable.

import type {
  MatchDetailResponse, EditionFixtureListResponse, EditionListResponse,
  TeamListResponse, TeamDetailResponse, PlayerListResponse, PlayerDetailResponse,
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

/** One match's detail, or null when the fixture does not exist. */
export function fetchMatch(matchId: string): Promise<MatchDetailResponse | null> {
  return getJson<MatchDetailResponse>(`/api/v2/matches/${encodeURIComponent(matchId)}`);
}

/** Teams in the governed authorized-active edition(s). Never 404s. */
export async function fetchTeams(): Promise<TeamListResponse> {
  const body = await getJson<TeamListResponse>('/api/v2/teams');
  return body ?? { teams: [] };
}

/** One team's identity/context, or null when not exposed under a governed edition. */
export function fetchTeam(teamId: string): Promise<TeamDetailResponse | null> {
  return getJson<TeamDetailResponse>(`/api/v2/teams/${encodeURIComponent(teamId)}`);
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
