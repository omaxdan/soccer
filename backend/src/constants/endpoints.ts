/**
 * ENDPOINT_REGISTRY
 *
 * Maps internal keys to SportsAPI Pro endpoints.
 * This pattern allows new endpoints to be added without code rewrites.
 *
 * Phase 1 (Data Warehouse Foundation) endpoints only.
 * Phase 2+ will add intelligence endpoints.
 */

export interface EndpointRegistry {
  [key: string]: {
    path: string;
    description: string;
    params?: Record<string, string>;
  };
}

export const ENDPOINT_REGISTRY: EndpointRegistry = {
  // Discovery endpoints
  tournaments: {
    path: '/tournaments',
    description: 'List all tournaments',
  },
  seasons: {
    path: '/seasons',
    description: 'List all seasons',
  },

  // Fixture & Schedule endpoints
  schedule: {
    path: '/schedule/{date}',
    description: 'Get fixtures for a specific date',
    params: {
      date: 'YYYY-MM-DD',
    },
  },

  // Match data endpoints
  match: {
    path: '/match/{id}',
    description: 'Get match details (teams, date, status)',
  },

  // Team & Squad endpoints
  team_players: {
    path: '/teams/{id}/players',
    description: 'Get squad roster for a team',
  },
  // ─── TEAM EVENT HISTORY ─────────────────────────────────────────────────────
  //
  // IMPORTANT: Both endpoints below are TARGETED-USE ONLY.
  // The /schedule/{date} master feed is the primary fixture source.
  // These endpoints cost 1 API call per team — do NOT use in daily cron.
  //
  // When to use team_events_last:
  //   • Backfilling form for a specific team whose history pre-dates your earliest
  //     schedule sync (rare — only needed when onboarding a new league)
  //   • Data quality check: verify a team's match count matches DB records
  //   • On-demand CLI only: npx ts-node src/cli.ts sync:team-events <teamId>
  //
  // When to use team_events_next:
  //   • Forward-looking fixture data for a single team beyond sync:week's 7-day window
  //   • NOTE: processTeamFixtureLoad already reads scheduled future matches from the
  //     matches table, so this endpoint is rarely needed unless syncing >7 days ahead
  //     for a specific team before a big match analysis
  //
  // Rate limit impact:
  //   • 76 target-league teams × 1 call = 76 calls (eats most of daily 100 budget)
  //   • Only run for a handful of specific teams at a time

  team_events_last: {
    path: '/teams/{id}/events/last/{limit}',
    description: 'Get last N completed matches for a team. Max 30. TARGETED USE ONLY.',
    params: {
      id:    'team external_id',
      limit: '1–30 (use 30 for max history)',
    },
  },

  team_events_next: {
    path: '/teams/{id}/events/next/{limit}',
    description: 'Get next N upcoming matches for a team. Max 30. TARGETED USE ONLY.',
    params: {
      id:    'team external_id',
      limit: '1–30 (use 30 for full upcoming schedule)',
    },
  },
};

// ─── SOFASCORE API ENDPOINTS ──────────────────────────────────────────────────
// Source 2 — Squad intelligence
// Base URL: https://api.sofascore.com/api/v1 (via SOFASCORE_BASE_URL env var)
// Client:   src/services/sofaScoreClient.ts
// NOTE: SofaScore uses SINGULAR "team" in the path, not "teams"
//
// These endpoints are NOT in ENDPOINT_REGISTRY because they use a different
// HTTP client (sofaScoreClient) with different base URL and headers.
// The path is constructed directly in syncSquadSofaScore.ts.
//
// ┌────────────────────────────────────────────────────────────────────────────┐
// │ /team/{id}/players   ← Primary squad endpoint. 1 call → 7 tables.        │
// │   Returns: player roster with injury status, positions, market values,    │
// │            contract dates, preferred foot, previous team (transfers)      │
// │   Throttle: 1 request per 2 seconds (queue-based, mandatory)             │
// │   CLI:      sync:squads:v2, sync:squads:countries:v2, sync:team-squad:v2 │
// └────────────────────────────────────────────────────────────────────────────┘

export const SOFASCORE_ENDPOINTS = {
  squad: {
    // Used in: syncSquadSofaScore.ts → sofaScoreClient.get(`/team/\${id}/players`)
    path: '/team/{id}/players',
    description: 'Full squad roster — injury, positions, market value, contract, transfers. 1 call → 7 tables.',
    source: 'SofaScore',
    throttle: '1 req / 2s (queue-based)',
    tables: ['players','player_injuries','player_transfers','team_squads_snapshot','team_position_depth','team_transfer_intelligence','team_intelligence'],
    params: {
      id: 'SofaScore team ID (= teams.external_id in DB)',
    },
  },
} as const;

/**
 * Resolves an endpoint path by substituting parameters.
 *
 * @example
 * resolveEndpoint('match', { id: '123' }) // '/match/123'
 * resolveEndpoint('team_events', { id: '456', limit: '10' }) // '/teams/456/events/last/10'
 */
export function resolveEndpoint(
  key: string,
  params: Record<string, string | number> = {}
): string {
  const endpoint = ENDPOINT_REGISTRY[key];
  if (!endpoint) {
    throw new Error(
      `Unknown endpoint key: ${key}. Available: ${Object.keys(ENDPOINT_REGISTRY).join(', ')}`
    );
  }

  let path = endpoint.path;
  Object.entries(params).forEach(([param, value]) => {
    path = path.replace(`{${param}}`, String(value));
  });

  // Check for unresolved placeholders
  const unresolvedMatches = path.match(/\{[^}]+\}/g);
  if (unresolvedMatches) {
    throw new Error(
      `Unresolved parameters in endpoint ${key}: ${unresolvedMatches.join(', ')}`
    );
  }

  return path;
}

/**
 * Returns the description of an endpoint
 */
export function getEndpointDescription(key: string): string {
  const endpoint = ENDPOINT_REGISTRY[key];
  if (!endpoint) {
    throw new Error(`Unknown endpoint key: ${key}`);
  }
  return endpoint.description;
}
