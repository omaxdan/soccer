// ─────────────────────────────────────────────────────────────────────────────
// V2 READ API — HTTP SERVER (Phase B.2) — `npm run api:v2`
//
//   GET /api/v2/matches/:matchId              → MatchDetailResponse
//   GET /api/v2/editions/:editionId/fixtures  → EditionFixtureListResponse
//
// The thinnest safe HTTP layer over the V2 read surfaces: Node's built-in http (no
// framework added), the existing pooled connection, and the existing handlers. It
// is a READ consumer of persisted V2 state — no writes, no calculation, no
// provider calls, no V1 dependency.
// ─────────────────────────────────────────────────────────────────────────────

import '../config/env';

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { PoolClient } from 'pg';
import { withConnection } from '../db/tx';
import { closeAllPools, installShutdownHandlers } from '../db/pool';
import { logger } from '../../utils/logger';
import { getMatchDetail, getMatchIntelligence, getMatchLineups, getMatchTeamStatistics, getMatchResult, getMatchLifecycle, getMatchVenue, getEditionFixtures, getEditionStandings, getEditions, getTeams, getTeamDetail, getTeamPerformance, getTeamReadiness, getTeamGovernedIntelligence, getTeamObservations, getPlayers, getPlayerDetail, getPlayerObservations, getVenue, getCountry, getCompetition, getEditionDetail, getEditionObservations, getSeasonPositionTrajectory, isValidId, isValidCountryCode } from './handlers';
import type { TeamObservationOptions } from './read/teamObservations';
import type { PlayerObservationOptions } from './read/playerObservations';
import type { EditionObservationOptions } from './read/editionObservations';
import type { SeasonPositionTrajectoryOptions } from './read/seasonPositionTrajectory';

/** Read/administrative connection label. One credential backs every V2 pool. */
export const API_ROLE = 'pt_platform_admin' as const;

/** The default port; overridable for local runs and tests. */
export const DEFAULT_API_PORT = 8787;

/** Injectable data seams so routing is testable without a database. */
export interface ApiDeps {
  readonly getMatch: (id: string) => Promise<unknown | null>;
  readonly getMatchIntelligence: (id: string) => Promise<unknown | null>;
  readonly getMatchLineups: (id: string) => Promise<unknown | null>;
  readonly getMatchTeamStatistics: (id: string) => Promise<unknown | null>;
  readonly getMatchResult: (id: string) => Promise<unknown | null>;
  readonly getMatchLifecycle: (id: string) => Promise<unknown | null>;
  readonly getMatchVenue: (id: string) => Promise<unknown | null>;
  readonly getEdition: (id: string) => Promise<unknown | null>;
  readonly getEditionStandings: (id: string) => Promise<unknown | null>;
  readonly getEditionObservations: (id: string, opts: EditionObservationOptions) => Promise<unknown | null>;
  readonly getSeasonPositionTrajectory: (id: string, opts: SeasonPositionTrajectoryOptions) => Promise<unknown | null>;
  readonly getEditions: () => Promise<unknown>;
  readonly getTeams: () => Promise<unknown>;
  readonly getTeam: (id: string) => Promise<unknown | null>;
  readonly getTeamPerformance: (id: string) => Promise<unknown | null>;
  readonly getTeamReadiness: (id: string) => Promise<unknown | null>;
  readonly getTeamGovernedIntelligence: (id: string) => Promise<unknown | null>;
  readonly getTeamObservations: (id: string, opts: TeamObservationOptions) => Promise<unknown | null>;
  readonly getPlayers: () => Promise<unknown>;
  readonly getPlayer: (id: string) => Promise<unknown | null>;
  readonly getPlayerObservations: (id: string, opts: PlayerObservationOptions) => Promise<unknown | null>;
  readonly getVenue: (id: string) => Promise<unknown | null>;
  readonly getCountry: (code: string) => Promise<unknown | null>;
  readonly getCompetition: (id: string) => Promise<unknown | null>;
  readonly getEditionDetail: (id: string) => Promise<unknown | null>;
}

const productionDeps: ApiDeps = {
  getMatch: (id) => withConnection(API_ROLE, (tx: PoolClient) => getMatchDetail(tx, id)),
  getMatchIntelligence: (id) => withConnection(API_ROLE, (tx: PoolClient) => getMatchIntelligence(tx, id)),
  getMatchLineups: (id) => withConnection(API_ROLE, (tx: PoolClient) => getMatchLineups(tx, id)),
  getMatchTeamStatistics: (id) => withConnection(API_ROLE, (tx: PoolClient) => getMatchTeamStatistics(tx, id)),
  getMatchResult: (id) => withConnection(API_ROLE, (tx: PoolClient) => getMatchResult(tx, id)),
  getMatchLifecycle: (id) => withConnection(API_ROLE, (tx: PoolClient) => getMatchLifecycle(tx, id)),
  getMatchVenue: (id) => withConnection(API_ROLE, (tx: PoolClient) => getMatchVenue(tx, id)),
  getEdition: (id) => withConnection(API_ROLE, (tx: PoolClient) => getEditionFixtures(tx, id)),
  getEditionStandings: (id) => withConnection(API_ROLE, (tx: PoolClient) => getEditionStandings(tx, id)),
  getEditionObservations: (id, opts) => withConnection(API_ROLE, (tx: PoolClient) => getEditionObservations(tx, id, opts)),
  getSeasonPositionTrajectory: (id, opts) => withConnection(API_ROLE, (tx: PoolClient) => getSeasonPositionTrajectory(tx, id, opts)),
  getEditions: () => withConnection(API_ROLE, (tx: PoolClient) => getEditions(tx)),
  getTeams: () => withConnection(API_ROLE, (tx: PoolClient) => getTeams(tx)),
  getTeam: (id) => withConnection(API_ROLE, (tx: PoolClient) => getTeamDetail(tx, id)),
  getTeamPerformance: (id) => withConnection(API_ROLE, (tx: PoolClient) => getTeamPerformance(tx, id)),
  getTeamReadiness: (id) => withConnection(API_ROLE, (tx: PoolClient) => getTeamReadiness(tx, id)),
  getTeamGovernedIntelligence: (id) => withConnection(API_ROLE, (tx: PoolClient) => getTeamGovernedIntelligence(tx, id)),
  getTeamObservations: (id, opts) => withConnection(API_ROLE, (tx: PoolClient) => getTeamObservations(tx, id, opts)),
  getPlayers: () => withConnection(API_ROLE, (tx: PoolClient) => getPlayers(tx)),
  getPlayer: (id) => withConnection(API_ROLE, (tx: PoolClient) => getPlayerDetail(tx, id)),
  getPlayerObservations: (id, opts) => withConnection(API_ROLE, (tx: PoolClient) => getPlayerObservations(tx, id, opts)),
  getVenue: (id) => withConnection(API_ROLE, (tx: PoolClient) => getVenue(tx, id)),
  getCountry: (code) => withConnection(API_ROLE, (tx: PoolClient) => getCountry(tx, code)),
  getCompetition: (id) => withConnection(API_ROLE, (tx: PoolClient) => getCompetition(tx, id)),
  getEditionDetail: (id) => withConnection(API_ROLE, (tx: PoolClient) => getEditionDetail(tx, id)),
};

export type Route =
  | { kind: 'editionList' }
  | { kind: 'match'; id: string }
  | { kind: 'matchIntelligence'; id: string }
  | { kind: 'matchLineups'; id: string }
  | { kind: 'matchTeamStatistics'; id: string }
  | { kind: 'matchResult'; id: string }
  | { kind: 'matchLifecycle'; id: string }
  | { kind: 'matchVenue'; id: string }
  | { kind: 'editionFixtures'; id: string }
  | { kind: 'editionStandings'; id: string }
  | { kind: 'editionObservations'; id: string }
  | { kind: 'seasonPositionTrajectory'; id: string }
  | { kind: 'edition'; id: string }
  | { kind: 'teamList' }
  | { kind: 'team'; id: string }
  | { kind: 'teamPerformance'; id: string }
  | { kind: 'teamReadiness'; id: string }
  | { kind: 'teamIntelligence'; id: string }
  | { kind: 'teamObservations'; id: string }
  | { kind: 'playerList' }
  | { kind: 'player'; id: string }
  | { kind: 'playerObservations'; id: string }
  | { kind: 'venue'; id: string }
  | { kind: 'country'; code: string }
  | { kind: 'competition'; id: string }
  | { kind: 'badRequest' }
  | { kind: 'methodNotAllowed' }
  | { kind: 'notFound' };

/** Pure router — matches method + pathname to an intent. No I/O. */
export function resolveRoute(method: string | undefined, pathname: string): Route {
  const isEditionList = pathname === '/api/v2/editions';
  const isTeamList = pathname === '/api/v2/teams';
  const isPlayerList = pathname === '/api/v2/players';
  const matchIntelligence = pathname.match(/^\/api\/v2\/matches\/([^/]+)\/intelligence$/);
  const matchLineups = pathname.match(/^\/api\/v2\/matches\/([^/]+)\/lineups$/);
  const matchTeamStatistics = pathname.match(/^\/api\/v2\/matches\/([^/]+)\/team-statistics$/);
  const matchResult = pathname.match(/^\/api\/v2\/matches\/([^/]+)\/result$/);
  const matchLifecycle = pathname.match(/^\/api\/v2\/matches\/([^/]+)\/lifecycle$/);
  const matchVenue = pathname.match(/^\/api\/v2\/matches\/([^/]+)\/venue$/);
  const match = pathname.match(/^\/api\/v2\/matches\/([^/]+)$/);
  const editionFixtures = pathname.match(/^\/api\/v2\/editions\/([^/]+)\/fixtures$/);
  const editionStandings = pathname.match(/^\/api\/v2\/editions\/([^/]+)\/standings$/);
  const editionObservations = pathname.match(/^\/api\/v2\/editions\/([^/]+)\/observations$/);
  const seasonPositionTrajectory = pathname.match(/^\/api\/v2\/editions\/([^/]+)\/position-trajectory$/);
  const editionDetail = pathname.match(/^\/api\/v2\/editions\/([^/]+)$/);
  const teamPerformance = pathname.match(/^\/api\/v2\/teams\/([^/]+)\/performance$/);
  const teamReadiness = pathname.match(/^\/api\/v2\/teams\/([^/]+)\/readiness$/);
  const teamIntelligence = pathname.match(/^\/api\/v2\/teams\/([^/]+)\/intelligence$/);
  const teamObservations = pathname.match(/^\/api\/v2\/teams\/([^/]+)\/observations$/);
  const team = pathname.match(/^\/api\/v2\/teams\/([^/]+)$/);
  const playerObservations = pathname.match(/^\/api\/v2\/players\/([^/]+)\/observations$/);
  const player = pathname.match(/^\/api\/v2\/players\/([^/]+)$/);
  const venue = pathname.match(/^\/api\/v2\/venues\/([^/]+)$/);
  const country = pathname.match(/^\/api\/v2\/countries\/([^/]+)$/);
  const competition = pathname.match(/^\/api\/v2\/competitions\/([^/]+)$/);
  if (!isEditionList && !isTeamList && !isPlayerList && !matchIntelligence && !matchLineups && !matchTeamStatistics && !matchResult && !matchLifecycle && !matchVenue && !match && !editionFixtures && !editionStandings && !editionObservations && !seasonPositionTrajectory && !editionDetail && !teamPerformance && !teamReadiness && !teamIntelligence && !teamObservations && !team && !playerObservations && !player && !venue && !country && !competition) {
    return { kind: 'notFound' };
  }
  if (method !== 'GET') return { kind: 'methodNotAllowed' };
  if (isEditionList) return { kind: 'editionList' };
  if (isTeamList) return { kind: 'teamList' };
  if (isPlayerList) return { kind: 'playerList' };
  if (matchIntelligence) {
    const id = decodeURIComponent(matchIntelligence[1]);
    return isValidId(id) ? { kind: 'matchIntelligence', id } : { kind: 'badRequest' };
  }
  if (matchLineups) {
    const id = decodeURIComponent(matchLineups[1]);
    return isValidId(id) ? { kind: 'matchLineups', id } : { kind: 'badRequest' };
  }
  if (matchTeamStatistics) {
    const id = decodeURIComponent(matchTeamStatistics[1]);
    return isValidId(id) ? { kind: 'matchTeamStatistics', id } : { kind: 'badRequest' };
  }
  if (matchResult) {
    const id = decodeURIComponent(matchResult[1]);
    return isValidId(id) ? { kind: 'matchResult', id } : { kind: 'badRequest' };
  }
  if (matchLifecycle) {
    const id = decodeURIComponent(matchLifecycle[1]);
    return isValidId(id) ? { kind: 'matchLifecycle', id } : { kind: 'badRequest' };
  }
  if (matchVenue) {
    const id = decodeURIComponent(matchVenue[1]);
    return isValidId(id) ? { kind: 'matchVenue', id } : { kind: 'badRequest' };
  }
  if (match) {
    const id = decodeURIComponent(match[1]);
    return isValidId(id) ? { kind: 'match', id } : { kind: 'badRequest' };
  }
  if (editionFixtures) {
    const id = decodeURIComponent(editionFixtures[1]);
    return isValidId(id) ? { kind: 'editionFixtures', id } : { kind: 'badRequest' };
  }
  if (editionStandings) {
    const id = decodeURIComponent(editionStandings[1]);
    return isValidId(id) ? { kind: 'editionStandings', id } : { kind: 'badRequest' };
  }
  if (editionObservations) {
    const id = decodeURIComponent(editionObservations[1]);
    return isValidId(id) ? { kind: 'editionObservations', id } : { kind: 'badRequest' };
  }
  if (seasonPositionTrajectory) {
    const id = decodeURIComponent(seasonPositionTrajectory[1]);
    return isValidId(id) ? { kind: 'seasonPositionTrajectory', id } : { kind: 'badRequest' };
  }
  if (editionDetail) {
    const id = decodeURIComponent(editionDetail[1]);
    return isValidId(id) ? { kind: 'edition', id } : { kind: 'badRequest' };
  }
  if (teamPerformance) {
    const id = decodeURIComponent(teamPerformance[1]);
    return isValidId(id) ? { kind: 'teamPerformance', id } : { kind: 'badRequest' };
  }
  if (teamReadiness) {
    const id = decodeURIComponent(teamReadiness[1]);
    return isValidId(id) ? { kind: 'teamReadiness', id } : { kind: 'badRequest' };
  }
  if (teamIntelligence) {
    const id = decodeURIComponent(teamIntelligence[1]);
    return isValidId(id) ? { kind: 'teamIntelligence', id } : { kind: 'badRequest' };
  }
  if (teamObservations) {
    const id = decodeURIComponent(teamObservations[1]);
    return isValidId(id) ? { kind: 'teamObservations', id } : { kind: 'badRequest' };
  }
  if (team) {
    const id = decodeURIComponent(team[1]);
    return isValidId(id) ? { kind: 'team', id } : { kind: 'badRequest' };
  }
  if (playerObservations) {
    const id = decodeURIComponent(playerObservations[1]);
    return isValidId(id) ? { kind: 'playerObservations', id } : { kind: 'badRequest' };
  }
  if (player) {
    const id = decodeURIComponent(player[1]);
    return isValidId(id) ? { kind: 'player', id } : { kind: 'badRequest' };
  }
  if (venue) {
    const id = decodeURIComponent(venue[1]);
    return isValidId(id) ? { kind: 'venue', id } : { kind: 'badRequest' };
  }
  // Countries are addressed by ISO alpha-2 code (case-insensitive in the URL); the
  // stored code is upper-case, so normalize before validating and dispatching.
  if (country) {
    const code = decodeURIComponent(country[1]).toUpperCase();
    return isValidCountryCode(code) ? { kind: 'country', code } : { kind: 'badRequest' };
  }
  const id = decodeURIComponent(competition![1]);
  return isValidId(id) ? { kind: 'competition', id } : { kind: 'badRequest' };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function parsePositiveInt(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/** Parse the Team Observations query filters from the URL. Lenient: unrecognized or
 *  invalid values fall back to defaults (venue/edition → none, order → asc, asOf →
 *  current time, limit/offset → none). Whitelisted, never interpolated into SQL. */
export function parseTeamObservationOptions(searchParams: URLSearchParams): TeamObservationOptions {
  const venueRaw = searchParams.get('venue');
  const venue: 'home' | 'away' | null = venueRaw === 'home' || venueRaw === 'away' ? venueRaw : null;
  const order: 'asc' | 'desc' = searchParams.get('order') === 'desc' ? 'desc' : 'asc';
  const editionRaw = searchParams.get('edition');
  const editionId = editionRaw && isValidId(editionRaw) ? editionRaw : null;
  const asOfRaw = searchParams.get('asOf');
  let asOf: Date | undefined;
  if (asOfRaw) { const d = new Date(asOfRaw); if (!Number.isNaN(d.getTime())) asOf = d; }
  return { asOf, editionId, venue, order, limit: parsePositiveInt(searchParams.get('limit')), offset: parsePositiveInt(searchParams.get('offset')) };
}

/** Parse the Edition Observations query filters from the URL. Whitelisted, lenient:
 *  asOf (default now), order (default asc), limit/offset. No venue option. */
export function parseEditionObservationOptions(searchParams: URLSearchParams): EditionObservationOptions {
  const order: 'asc' | 'desc' = searchParams.get('order') === 'desc' ? 'desc' : 'asc';
  const asOfRaw = searchParams.get('asOf');
  let asOf: Date | undefined;
  if (asOfRaw) { const d = new Date(asOfRaw); if (!Number.isNaN(d.getTime())) asOf = d; }
  return { asOf, order, limit: parsePositiveInt(searchParams.get('limit')), offset: parsePositiveInt(searchParams.get('offset')) };
}

/** Parse the Season Position Trajectory query filters. Whitelisted, lenient: asOf
 *  (default now, strict `<`), team (optional teamId filter), order (default asc),
 *  limit/offset (applied after full reconstruction). */
export function parseSeasonPositionTrajectoryOptions(searchParams: URLSearchParams): SeasonPositionTrajectoryOptions {
  const order: 'asc' | 'desc' = searchParams.get('order') === 'desc' ? 'desc' : 'asc';
  const teamRaw = searchParams.get('team');
  const teamId = teamRaw && isValidId(teamRaw) ? teamRaw : null;
  const asOfRaw = searchParams.get('asOf');
  let asOf: Date | undefined;
  if (asOfRaw) { const d = new Date(asOfRaw); if (!Number.isNaN(d.getTime())) asOf = d; }
  return { asOf, teamId, order, limit: parsePositiveInt(searchParams.get('limit')), offset: parsePositiveInt(searchParams.get('offset')) };
}

/** Parse the Player Observations query filters from the URL. Same lenient, whitelisted
 *  conventions as the Team Observations parser (never interpolated into SQL). */
export function parsePlayerObservationOptions(searchParams: URLSearchParams): PlayerObservationOptions {
  const venueRaw = searchParams.get('venue');
  const venue: 'home' | 'away' | null = venueRaw === 'home' || venueRaw === 'away' ? venueRaw : null;
  const order: 'asc' | 'desc' = searchParams.get('order') === 'desc' ? 'desc' : 'asc';
  const editionRaw = searchParams.get('edition');
  const editionId = editionRaw && isValidId(editionRaw) ? editionRaw : null;
  const asOfRaw = searchParams.get('asOf');
  let asOf: Date | undefined;
  if (asOfRaw) { const d = new Date(asOfRaw); if (!Number.isNaN(d.getTime())) asOf = d; }
  return { asOf, editionId, venue, order, limit: parsePositiveInt(searchParams.get('limit')), offset: parsePositiveInt(searchParams.get('offset')) };
}

/** Handles one request against the given data seams. */
export async function handleRequest(req: IncomingMessage, res: ServerResponse, deps: ApiDeps): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const route = resolveRoute(req.method, url.pathname);
  try {
    switch (route.kind) {
      case 'notFound':
        return sendJson(res, 404, { error: 'not_found' });
      case 'methodNotAllowed':
        return sendJson(res, 405, { error: 'method_not_allowed' });
      case 'badRequest':
        return sendJson(res, 400, { error: 'invalid_id' });
      case 'editionList':
        return sendJson(res, 200, await deps.getEditions());
      case 'match': {
        const body = await deps.getMatch(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'match_not_found' });
      }
      case 'matchIntelligence': {
        const body = await deps.getMatchIntelligence(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'match_intelligence_not_found' });
      }
      case 'matchLineups': {
        const body = await deps.getMatchLineups(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'match_not_found' });
      }
      case 'matchTeamStatistics': {
        const body = await deps.getMatchTeamStatistics(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'match_not_found' });
      }
      case 'matchResult': {
        const body = await deps.getMatchResult(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'match_not_found' });
      }
      case 'matchLifecycle': {
        const body = await deps.getMatchLifecycle(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'match_not_found' });
      }
      case 'matchVenue': {
        const body = await deps.getMatchVenue(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'match_not_found' });
      }
      case 'editionFixtures': {
        const body = await deps.getEdition(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'edition_not_found' });
      }
      case 'editionStandings': {
        const body = await deps.getEditionStandings(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'edition_not_found' });
      }
      case 'editionObservations': {
        const body = await deps.getEditionObservations(route.id, parseEditionObservationOptions(url.searchParams));
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'edition_not_found' });
      }
      case 'seasonPositionTrajectory': {
        const body = await deps.getSeasonPositionTrajectory(route.id, parseSeasonPositionTrajectoryOptions(url.searchParams));
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'edition_not_found' });
      }
      case 'teamList':
        return sendJson(res, 200, await deps.getTeams());
      case 'teamPerformance': {
        const body = await deps.getTeamPerformance(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'team_not_found' });
      }
      case 'teamReadiness': {
        const body = await deps.getTeamReadiness(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'team_not_found' });
      }
      case 'teamObservations': {
        const body = await deps.getTeamObservations(route.id, parseTeamObservationOptions(url.searchParams));
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'team_not_found' });
      }
      case 'teamIntelligence': {
        const body = await deps.getTeamGovernedIntelligence(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'team_not_found' });
      }
      case 'team': {
        const body = await deps.getTeam(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'team_not_found' });
      }
      case 'playerList':
        return sendJson(res, 200, await deps.getPlayers());
      case 'playerObservations': {
        const body = await deps.getPlayerObservations(route.id, parsePlayerObservationOptions(url.searchParams));
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'player_not_found' });
      }
      case 'player': {
        const body = await deps.getPlayer(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'player_not_found' });
      }
      case 'venue': {
        const body = await deps.getVenue(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'venue_not_found' });
      }
      case 'country': {
        const body = await deps.getCountry(route.code);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'country_not_found' });
      }
      case 'competition': {
        const body = await deps.getCompetition(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'competition_not_found' });
      }
      case 'edition': {
        const body = await deps.getEditionDetail(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'edition_not_found' });
      }
    }
  } catch (error) {
    logger.error({ path: url.pathname, err: error instanceof Error ? error.message : String(error) }, 'v2 api: request failed');
    return sendJson(res, 500, { error: 'internal_error' });
  }
}

/** Builds the server. `deps` defaults to the real read handlers. */
export function createServer(deps: ApiDeps = productionDeps): Server {
  return createHttpServer((req, res) => {
    void handleRequest(req, res, deps);
  });
}

export async function main(): Promise<void> {
  const port = Number(process.env.PT_V2_API_PORT ?? DEFAULT_API_PORT);
  const server = createServer();
  installShutdownHandlers();
  server.on('close', () => { void closeAllPools(); });
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`\nv2 read API listening on http://127.0.0.1:${port}\n  GET /api/v2/editions\n  GET /api/v2/editions/:editionId\n  GET /api/v2/editions/:editionId/fixtures\n  GET /api/v2/editions/:editionId/standings\n  GET /api/v2/editions/:editionId/observations\n  GET /api/v2/editions/:editionId/position-trajectory\n  GET /api/v2/matches/:matchId\n  GET /api/v2/matches/:matchId/intelligence\n  GET /api/v2/matches/:matchId/lineups\n  GET /api/v2/matches/:matchId/team-statistics\n  GET /api/v2/matches/:matchId/result\n  GET /api/v2/matches/:matchId/lifecycle\n  GET /api/v2/matches/:matchId/venue\n  GET /api/v2/teams\n  GET /api/v2/teams/:teamId\n  GET /api/v2/teams/:teamId/performance\n  GET /api/v2/teams/:teamId/readiness\n  GET /api/v2/teams/:teamId/intelligence\n  GET /api/v2/teams/:teamId/observations\n  GET /api/v2/players\n  GET /api/v2/players/:playerId\n  GET /api/v2/players/:playerId/observations\n  GET /api/v2/venues/:venueId\n  GET /api/v2/countries/:countryCode\n  GET /api/v2/competitions/:competitionId\n`);
  });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('\nv2 api FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
