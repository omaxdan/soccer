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
import { getMatchDetail, getEditionFixtures, isValidId } from './handlers';

/** Read/administrative connection label. One credential backs every V2 pool. */
export const API_ROLE = 'pt_platform_admin' as const;

/** The default port; overridable for local runs and tests. */
export const DEFAULT_API_PORT = 8787;

/** Injectable data seams so routing is testable without a database. */
export interface ApiDeps {
  readonly getMatch: (id: string) => Promise<unknown | null>;
  readonly getEdition: (id: string) => Promise<unknown | null>;
}

const productionDeps: ApiDeps = {
  getMatch: (id) => withConnection(API_ROLE, (tx: PoolClient) => getMatchDetail(tx, id)),
  getEdition: (id) => withConnection(API_ROLE, (tx: PoolClient) => getEditionFixtures(tx, id)),
};

export type Route =
  | { kind: 'match'; id: string }
  | { kind: 'editionFixtures'; id: string }
  | { kind: 'badRequest' }
  | { kind: 'methodNotAllowed' }
  | { kind: 'notFound' };

/** Pure router — matches method + pathname to an intent. No I/O. */
export function resolveRoute(method: string | undefined, pathname: string): Route {
  const match = pathname.match(/^\/api\/v2\/matches\/([^/]+)$/);
  const editionFixtures = pathname.match(/^\/api\/v2\/editions\/([^/]+)\/fixtures$/);
  if (!match && !editionFixtures) return { kind: 'notFound' };
  if (method !== 'GET') return { kind: 'methodNotAllowed' };
  if (match) {
    const id = decodeURIComponent(match[1]);
    return isValidId(id) ? { kind: 'match', id } : { kind: 'badRequest' };
  }
  const id = decodeURIComponent(editionFixtures![1]);
  return isValidId(id) ? { kind: 'editionFixtures', id } : { kind: 'badRequest' };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

/** Handles one request against the given data seams. */
export async function handleRequest(req: IncomingMessage, res: ServerResponse, deps: ApiDeps): Promise<void> {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  const route = resolveRoute(req.method, pathname);
  try {
    switch (route.kind) {
      case 'notFound':
        return sendJson(res, 404, { error: 'not_found' });
      case 'methodNotAllowed':
        return sendJson(res, 405, { error: 'method_not_allowed' });
      case 'badRequest':
        return sendJson(res, 400, { error: 'invalid_id' });
      case 'match': {
        const body = await deps.getMatch(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'match_not_found' });
      }
      case 'editionFixtures': {
        const body = await deps.getEdition(route.id);
        return body ? sendJson(res, 200, body) : sendJson(res, 404, { error: 'edition_not_found' });
      }
    }
  } catch (error) {
    logger.error({ path: pathname, err: error instanceof Error ? error.message : String(error) }, 'v2 api: request failed');
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
    console.log(`\nv2 read API listening on http://127.0.0.1:${port}\n  GET /api/v2/matches/:matchId\n  GET /api/v2/editions/:editionId/fixtures\n`);
  });
}

if (require.main === module) {
  main().catch((error: unknown) => {
    // eslint-disable-next-line no-console
    console.error('\nv2 api FAILED:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
