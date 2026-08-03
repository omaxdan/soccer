// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER ENDPOINT REGISTRY
//
// ONE REGISTRY, EVERY PATH. V1 had a registry covering seven endpoints and four
// more constructed inline — squad, transfers, standings and images. Those four
// bypassed the registry entirely, which mattered less when nothing measured
// quota. It matters now: operations.api_usage.endpoint_key is NOT NULL, and an
// endpoint that never reaches the registry never reaches the telemetry either,
// so consumption would under-report by exactly the calls that cost the most.
//
// ─────────────────────────────────────────────────────────────────────────────
// QUOTA IS THE BINDING CONSTRAINT
//
// 100 requests per key per day, two keys, 200 total. E9.05 states the position
// plainly: ingestion is quota-bound rather than compute-bound, and "an unmeasured
// binding constraint cannot be managed".
//
// Endpoints are therefore classified by COST CLASS, not just by path. A feed
// endpoint returns many entities for one call and can run daily. A per-entity
// endpoint costs one call per team — 76 tracked teams is most of a single key's
// budget — and must be driven by an explicit, bounded work list, never by a loop
// over every team the platform knows.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How expensive an endpoint is relative to the daily budget.
 *
 * FEED       one call returns entities at many levels. Safe on a daily schedule.
 * PER_ENTITY one call per subject. Bounded work lists only.
 * DISCOVERY  one call, whole-catalogue. Run rarely; the catalogue changes slowly.
 */
export type EndpointCostClass = 'FEED' | 'PER_ENTITY' | 'DISCOVERY';

export interface EndpointDefinition {
  /** Stable key. Written to operations.api_usage.endpoint_key — never renamed. */
  readonly key: string;
  readonly path: string;
  readonly costClass: EndpointCostClass;
  readonly description: string;
  /** Named path parameters, in the order they appear. */
  readonly parameters: readonly string[];
}

/**
 * Every path S-4 may call.
 *
 * The four V1 constructed inline are here as first-class entries: `team_squad`,
 * `team_transfers`, `season_standings` and the two image paths — the last of
 * which is registered and then deliberately never called, so that its absence
 * from the ingestion path is a recorded decision rather than an oversight.
 */
export const ENDPOINTS = {
  schedule: {
    key: 'schedule',
    path: '/schedule/{date}',
    costClass: 'FEED',
    description:
      'Fixtures for one UTC date. THE PRIMARY SOURCE: a single response carries competition, season, venue, team, fixture and score, which is why it can sustain full coverage on one call a day.',
    parameters: ['date'],
  },
  tournaments: {
    key: 'tournaments',
    path: '/tournaments',
    costClass: 'DISCOVERY',
    description: 'Whole tournament catalogue. Changes slowly; run on demand, not on a schedule.',
    parameters: [],
  },
  seasons: {
    key: 'seasons',
    path: '/seasons',
    costClass: 'DISCOVERY',
    description: 'Whole season catalogue. Supplies the bounded season_period a competition edition requires.',
    parameters: [],
  },
  team_squad: {
    key: 'team_squad',
    path: '/team/{id}/players',
    costClass: 'PER_ENTITY',
    description:
      'Full squad: roster, injury spells, positions, market values, contract dates. V1 turned one response into seven tables; V2 turns it into player, player_registration, player_availability and player_valuation.',
    parameters: ['id'],
  },
  team_players: {
    key: 'team_players',
    path: '/teams/{id}/players',
    costClass: 'PER_ENTITY',
    description:
      'Roster only, without the squad endpoint\'s injury and valuation detail. Retained because it is the cheaper call when only registration is wanted.',
    parameters: ['id'],
  },
  team_transfers: {
    key: 'team_transfers',
    path: '/teams/{id}/transfers',
    costClass: 'PER_ENTITY',
    description:
      'Transfers in and out. A transfer is the BOUNDARY between two registrations, so this feeds player_registration succession — never a standalone transfer record.',
    parameters: ['id'],
  },
  season_standings: {
    key: 'season_standings',
    path: '/tournament/{tournamentId}/season/{seasonId}/standings',
    costClass: 'PER_ENTITY',
    description:
      'League table for one tournament season. Written to football.standing with as_of_on, which is append-only — yesterday\'s table is never overwritten.',
    parameters: ['tournamentId', 'seasonId'],
  },
  tournament_team_events: {
    key: 'tournament_team_events',
    path: '/tournament/{tournamentId}/season/{seasonId}/team-events',
    costClass: 'PER_ENTITY',
    description:
      'All events for a tournament season, same shape as the schedule feed. seasonId must be a real external id — the provider returns 404 for 0, confirmed in V1 live testing.',
    parameters: ['tournamentId', 'seasonId'],
  },
  team_events_last: {
    key: 'team_events_last',
    path: '/teams/{id}/events/last/{limit}',
    costClass: 'PER_ENTITY',
    description:
      'Last N completed matches for one team, max 30. TARGETED USE ONLY — 76 tracked teams would consume most of a day\'s budget.',
    parameters: ['id', 'limit'],
  },
  team_events_next: {
    key: 'team_events_next',
    path: '/teams/{id}/events/next/{limit}',
    costClass: 'PER_ENTITY',
    description:
      'Next N fixtures for one team, max 30. Rarely needed — the schedule feed already covers the forward window.',
    parameters: ['id', 'limit'],
  },
} as const satisfies Record<string, EndpointDefinition>;

export type EndpointKey = keyof typeof ENDPOINTS;

/**
 * Endpoints registered but NEVER CALLED by ingestion.
 *
 * The image paths return binary assets. No V2 relation holds them, because a
 * club crest is not football reality — it is presentation. Recorded here so that
 * their absence from the ingestion path is a decision anyone can find, rather
 * than a gap someone later fills by reflex.
 */
export const DELIBERATELY_NOT_INGESTED = [
  { path: '/teams/{id}/image', reason: 'Binary asset. No V2 relation holds crests; presentation, not reality.' },
  { path: '/tournament/{id}/image', reason: 'Binary asset. As above.' },
] as const;

/**
 * Substitutes path parameters, refusing anything unresolved.
 *
 * An unresolved placeholder reaching the provider produces a 404 that looks like
 * a missing entity rather than a missing argument, so it is caught here where the
 * cause is still legible. V1 did the same and was right to.
 */
export function resolvePath(key: EndpointKey, params: Record<string, string | number> = {}): string {
  const endpoint: EndpointDefinition = ENDPOINTS[key];

  let path: string = endpoint.path;
  for (const [name, value] of Object.entries(params)) {
    path = path.split(`{${name}}`).join(encodeURIComponent(String(value)));
  }

  const unresolved = path.match(/\{[^}]+\}/g);
  if (unresolved) {
    throw new Error(
      `Endpoint '${key}' has unresolved parameters ${unresolved.join(', ')}. ` +
        `It declares: ${endpoint.parameters.join(', ') || '(none)'}.`
    );
  }
  return path;
}
