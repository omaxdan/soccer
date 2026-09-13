// V2 ROUTE HELPERS — the single source of truth for internal V2 URLs.
//
// Every in-app link goes through these helpers instead of hardcoding a path, so the
// URL namespace lives in exactly ONE place: `V2_BASE`.
//
// `/v2` is TEMPORARY migration-time routing. When the app takes the root domain
// (https://www.pitchterminal.com/), the cutover is a one-line change here —
// `V2_BASE = ''` — and every link flattens automatically:
//     /v2/matches/<slug>  →  /matches/<slug>
// No call site changes, no route-file moves required in the frontend. (`/pitch` is a
// legacy namespace and is never produced by these helpers.)
//
// These are pure functions (safe in server and client components). Slug generation
// reuses the canonical slug helpers — there is no second slug system.

import { v2MatchSlug, v2TeamSlug, v2PlayerSlug, type V2SlugFixture } from './slug';

/** The current URL namespace. Set to '' at the root-domain cutover to flatten all
 *  V2 links. This is the ONLY place the prefix is defined. */
export const V2_BASE = '/v2';

/** Join the base and an app-relative path. Trailing slash on the base is trimmed;
 *  the index path ('/') collapses to the bare base (or '/' when the base is empty),
 *  so flattening to the root domain yields clean URLs. Pure. */
export function v2Path(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  if (path === '/' || path === '') return b || '/';
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${b}${p}`;
}

/** Canonical internal V2 routes. Add future surfaces here, never as inline strings. */
export const routes = {
  /** Leagues index — the current V2 landing (the base itself). */
  leagues: (): string => v2Path(V2_BASE, '/'),
  /** One competition edition's fixtures (match discovery). */
  edition: (editionId: string): string => v2Path(V2_BASE, `/editions/${encodeURIComponent(editionId)}`),
  /** A match page, from a fixture (home/away/id → canonical slug). */
  match: (fixture: V2SlugFixture): string => v2Path(V2_BASE, `/matches/${v2MatchSlug(fixture)}`),
  /** A match page, from an already-built slug (e.g. the current route param). */
  matchBySlug: (slug: string): string => v2Path(V2_BASE, `/matches/${slug}`),
  /** Teams directory. */
  teams: (): string => v2Path(V2_BASE, '/teams'),
  /** One team's page. */
  team: (team: { id: string; name: string }): string => v2Path(V2_BASE, `/teams/${v2TeamSlug(team)}`),
  /** Players directory. */
  players: (): string => v2Path(V2_BASE, '/players'),
  /** One player's page. */
  player: (player: { id: string; fullName: string }): string => v2Path(V2_BASE, `/players/${v2PlayerSlug(player)}`),
} as const;
