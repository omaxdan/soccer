import { sportsApiClient } from '../services/sportsApiClient';
import { resolveEndpoint } from '../constants/endpoints';
import { teamsRepository } from '../repositories/TeamsRepository';
import { playersRepository } from '../repositories/PlayersRepository';
import { transformPlayer } from '../transformers/index';
import { logger } from '../utils/logger';
import { db } from '../db/client';
import type { SportsAPIPlayer } from '../types/index';

const SQUAD_SYNC_COOLDOWN_DAYS = 7;

/**
 * SMART SQUAD SYNC
 *
 * Rate limit strategy:
 *   The /teams/{id}/players endpoint is called ONCE PER TEAM.
 *   With hundreds of teams, calling all daily is wasteful.
 *
 *   Strategy: only sync a team's squad if no snapshot exists
 *   in the last SQUAD_SYNC_COOLDOWN_DAYS (default: 7 days).
 *
 *   Priority boost: teams with matches in next 3 days are synced first.
 *
 * Result: ~7× fewer API calls for squad data.
 */

async function wasRecentlySynced(teamId: number): Promise<boolean> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - SQUAD_SYNC_COOLDOWN_DAYS);
  const cutoffDate = cutoff.toISOString().split('T')[0];

  const { data } = await db
    .from('team_squads_snapshot')
    .select('snapshot_date')
    .eq('team_id', teamId)
    .gte('snapshot_date', cutoffDate)
    .limit(1);

  return (data?.length ?? 0) > 0;
}

async function getTeamsWithUpcomingMatches(withinDays = 3): Promise<Set<number>> {
  const now = new Date().toISOString();
  const future = new Date();
  future.setDate(future.getDate() + withinDays);

  const { data } = await db
    .from('matches')
    .select('home_team_id, away_team_id')
    .eq('status', 'scheduled')
    .gte('date', now)
    .lte('date', future.toISOString());

  const teamIds = new Set<number>();
  for (const m of data || []) {
    teamIds.add(m.home_team_id);
    teamIds.add(m.away_team_id);
  }
  return teamIds;
}

export async function syncTeamPlayers(
  teamExternalId: number,
  force = false
): Promise<{ playersProcessed: number; skipped: boolean; squadMetrics: any }> {
  logger.debug({ teamExternalId }, 'Checking squad sync eligibility');

  try {
    const team = await teamsRepository.findByExternalId(teamExternalId);
    if (!team) {
      logger.warn({ teamExternalId }, 'Team not found in DB');
      return { playersProcessed: 0, skipped: true, squadMetrics: null };
    }

    // Skip if recently synced (unless forced)
    if (!force && await wasRecentlySynced(team.id)) {
      logger.debug({ teamId: team.id, name: team.name }, 'Squad recently synced — skipping');
      return { playersProcessed: 0, skipped: true, squadMetrics: null };
    }

    const endpoint = resolveEndpoint('team_players', { id: teamExternalId });
    const response = await sportsApiClient.get<any>(endpoint);

    // SportsAPI returns players at different paths depending on endpoint version
    const rawPlayers: any[] = response.players || response.data?.players || response.response || [];

    logger.debug({ teamId: team.id, playerCount: rawPlayers.length }, 'Fetched team players');

    if (rawPlayers.length === 0) {
      logger.warn({ teamId: team.id }, 'No players returned from API');
      return { playersProcessed: 0, skipped: false, squadMetrics: null };
    }

    // Log raw structure of first player ONCE so we can confirm the shape
    logger.debug(
      { sample: JSON.stringify(rawPlayers[0]).slice(0, 500) },
      'Raw player sample (first record)'
    );

    // Normalise: SportsAPI /teams/{id}/players may return players as:
    //   A) Flat:   { id, name, position, dateOfBirth, ... }
    //   B) Nested: { player: { id, name, ... }, statistics: [...] }
    //   C) Nested: { player: { id, name, ... }, position: {...} }
    const apiPlayers: any[] = rawPlayers.map((raw: any) => {
      // If the player object is nested under a "player" key, unwrap it
      const p = raw.player ?? raw;

      return {
        id:            p.id           ?? p.playerId    ?? null,
        name:          p.name         ?? p.fullName    ?? 'Unknown',
        shortName:     p.shortName    ?? p.displayName ?? null,
        position:      typeof p.position === 'object'
                         ? p.position?.name ?? p.position?.code ?? null
                         : p.position       ?? null,
        nationality:   p.country?.name ?? p.nationality ?? null,
        // dateOfBirth can be a string OR a unix timestamp field
        dateOfBirth:   p.dateOfBirth
                         ?? (p.dateOfBirthTimestamp
                             ? new Date(p.dateOfBirthTimestamp * 1000).toISOString().split('T')[0]
                             : null),
        market_value:  p.proposedMarketValue ?? p.marketValue ?? p.market_value ?? null,
      };
    });

    // Filter out any player whose id came back null — log them for debugging
    const validPlayers = apiPlayers.filter(p => p.id != null);
    const nullIdCount  = apiPlayers.length - validPlayers.length;
    if (nullIdCount > 0) {
      logger.warn(
        { teamId: team.id, nullIdCount, sample: JSON.stringify(rawPlayers[0]).slice(0, 300) },
        'Some players have no external_id — skipped. Check raw sample above for correct field name.'
      );
    }
    if (validPlayers.length === 0) {
      logger.error({ teamId: team.id }, 'All players had null id — nothing to upsert. Check API response shape.');
      return { playersProcessed: 0, skipped: false, squadMetrics: null };
    }

    const players = validPlayers.map((p: any) => transformPlayer(p, team.id));
    await playersRepository.upsertBatch(players);

    // Squad metrics — use validPlayers (those with a resolved external_id)
    const foreignCount = validPlayers.filter(
      (p: any) => p.nationality !== team.country
    ).length;

    let avgAge: number | null = null;
    const ages = validPlayers
      .filter((p: any) => p.dateOfBirth)
      .map((p: any) => {
        const birth = new Date(p.dateOfBirth);
        const today = new Date();
        let age = today.getFullYear() - birth.getFullYear();
        if (
          today.getMonth() < birth.getMonth() ||
          (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
        ) age--;
        return age;
      });

    if (ages.length > 0) {
      avgAge = Math.round((ages.reduce((a: number, b: number) => a + b, 0) / ages.length) * 100) / 100;
    }

    const squadMetrics = {
      players_count: apiPlayers.length,
      foreign_players_count: foreignCount,
      domestic_players_count: apiPlayers.length - foreignCount,
      avg_age: avgAge,
    };

    const today = new Date().toISOString().split('T')[0];
    const { error } = await db.from('team_squads_snapshot').upsert(
      { team_id: team.id, snapshot_date: today, ...squadMetrics },
      { onConflict: 'team_id,snapshot_date' }
    );
    if (error) throw error;

    logger.info({ teamId: team.id, name: team.name, players: players.length }, 'Squad synced');
    return { playersProcessed: players.length, skipped: false, squadMetrics };

  } catch (error: any) {
    logger.error({ error: error.message, teamExternalId }, 'Squad sync failed');
    throw error;
  }
}

/**
 * Sync squads smartly across all known teams.
 *
 * Order of priority:
 *   1. Teams with matches in the next 3 days (sync immediately)
 *   2. All other teams (only if not synced in last 7 days)
 *
 * delayMs: pause between each API call to protect rate limits
 */
export async function syncAllTeamsPlayers(
  delayMs = 1000
): Promise<{ synced: number; skipped: number; failed: number }> {
  logger.info({ cooldownDays: SQUAD_SYNC_COOLDOWN_DAYS }, 'Smart squad sync started — using tracked leagues filter');

  // Only sync teams that appear in tracked-league matches (not all 3,756 global teams)
  const trackedTeams = await getTrackedLeagueTeams();

  if (trackedTeams.length === 0) {
    logger.warn('No teams found in tracked-league matches. Run sync:today first to populate matches.');
    return { synced: 0, skipped: 0, failed: 0 };
  }

  const upcomingTeamIds = await getTeamsWithUpcomingMatches(3);

  const prioritised = [
    ...trackedTeams.filter((t: any) => upcomingTeamIds.has(t.id)),
    ...trackedTeams.filter((t: any) => !upcomingTeamIds.has(t.id)),
  ];

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const team of prioritised) {
    try {
      const result = await syncTeamPlayers((team as any).external_id, upcomingTeamIds.has((team as any).id));
      if (result.skipped) skipped++;
      else {
        synced++;
        await new Promise(r => setTimeout(r, delayMs));
      }
    } catch {
      failed++;
    }
  }

  logger.info(
    { total: trackedTeams.length, synced, skipped, failed },
    'Smart squad sync completed'
  );
  return { synced, skipped, failed };
}

/**
 * Returns teams that appear in tracked-league matches.
 * This is the efficient alternative to fetching all 3,756 global teams.
 */
async function getTrackedLeagueTeams(): Promise<any[]> {
  // Get all matches that have a competition name (set from tracked leagues in master feed)
  const { data: matches } = await db
    .from('matches')
    .select('home_team_id, away_team_id')
    .not('competition', 'is', null);

  if (!matches || matches.length === 0) return [];

  // Collect unique team IDs
  const teamIdSet = new Set<number>();
  for (const m of matches) {
    if (m.home_team_id) teamIdSet.add(m.home_team_id);
    if (m.away_team_id) teamIdSet.add(m.away_team_id);
  }

  if (teamIdSet.size === 0) return [];

  const { data: teams } = await db
    .from('teams')
    .select('id, external_id, name, country')
    .in('id', Array.from(teamIdSet));

  logger.info({ count: teams?.length ?? 0 }, 'Tracked-league teams resolved');
  return teams || [];
}

/**
 * Sync squads for specific countries only.
 *
 * Use this instead of syncAllTeamsPlayers when you only care about
 * certain leagues (e.g. Brazil, Finland, Lithuania, Argentina).
 *
 * With 3,756 total teams, syncing all takes ~3 hours on first run.
 * Targeting 2-4 countries reduces this to ~10-15 minutes.
 *
 * Example:
 *   syncTeamsByCountries(['Brazil', 'Finland', 'Lithuania', 'Argentina'])
 */
export async function syncTeamsByCountries(
  countries: string[],
  delayMs = 1000
): Promise<{ synced: number; skipped: number; failed: number; teams: number }> {
  logger.info({ countries }, 'Country-filtered squad sync started');

  // IMPORTANT: filter teams through TRACKED-LEAGUE MATCHES, not the raw teams table.
  // The teams table has 3,756 global entries. The matches table only contains
  // fixtures from our 42 tracked leagues. Intersecting gives us only the teams
  // we actually need player data for.
  const trackedTeams = await getTrackedLeagueTeams();
  const allTeams = trackedTeams.filter(
    (t: any) => countries.map(c => c.toLowerCase()).includes((t.country || '').toLowerCase())
  );

  if (allTeams.length === 0) {
    logger.warn({ countries }, 'No tracked-league teams found for these countries. Run sync:today first.');
    return { synced: 0, skipped: 0, failed: 0, teams: 0 };
  }

  const upcomingTeamIds = await getTeamsWithUpcomingMatches(3);

  const prioritised = [
    ...allTeams.filter((t: any) => upcomingTeamIds.has(t.id)),
    ...allTeams.filter((t: any) => !upcomingTeamIds.has(t.id)),
  ];

  logger.info(
    {
      countries,
      trackedLeagueTotal: trackedTeams.length,
      countryFiltered: prioritised.length,
      upcomingCount: upcomingTeamIds.size,
    },
    'Country-filtered teams queued (tracked leagues only)'
  );

  let synced = 0;
  let skipped = 0;
  let failed = 0;

  for (const team of prioritised) {
    try {
      const result = await syncTeamPlayers(
        (team as any).external_id,
        upcomingTeamIds.has((team as any).id)
      );
      if (result.skipped) skipped++;
      else {
        synced++;
        await new Promise(r => setTimeout(r, delayMs));
      }
    } catch {
      failed++;
    }
  }

  logger.info({ countries, teams: prioritised.length, synced, skipped, failed }, 'Country squad sync completed');
  return { synced, skipped, failed, teams: prioritised.length };
}

/**
 * PRIMARY SQUAD SYNC COMMAND
 *
 * Syncs players ONLY for teams in the 42 tracked leagues.
 * Derives the team list entirely from the matches table (already filtered
 * to tracked leagues by the master feed) — no country guessing needed.
 *
 * This is the recommended daily cron command for squad sync.
 *
 * Rate limit budget:
 *   Tracked-league teams ≈ 400–600 (vs 3,756 global)
 *   7-day cooldown → ~60–90 calls/day ongoing
 *   First run: ~400–600 calls (spread across multiple days if needed)
 *
 * Priority: teams with matches in next 3 days are synced first.
 */
export async function syncSquadsForTrackedLeagues(
  delayMs = 1000
): Promise<{ synced: number; skipped: number; failed: number; teams: number }> {
  logger.info('syncSquadsForTrackedLeagues started — tracked leagues only');

  const trackedTeams = await getTrackedLeagueTeams();

  if (trackedTeams.length === 0) {
    logger.warn('No tracked-league teams found. Ensure sync:today has run at least once.');
    return { synced: 0, skipped: 0, failed: 0, teams: 0 };
  }

  const upcomingTeamIds = await getTeamsWithUpcomingMatches(3);

  // Priority order: upcoming matches first, then remaining alphabetically
  const prioritised = [
    ...trackedTeams.filter((t: any) => upcomingTeamIds.has(t.id)),
    ...trackedTeams.filter((t: any) => !upcomingTeamIds.has(t.id)),
  ];

  logger.info(
    {
      trackedLeagueTeams: trackedTeams.length,
      upcomingPriority: upcomingTeamIds.size,
    },
    'Tracked-league squad sync queued'
  );

  let synced = 0;
  let skipped = 0;
  let failed = 0;
  let apiCalls = 0;

  for (const team of prioritised) {
    try {
      const result = await syncTeamPlayers(
        (team as any).external_id,
        upcomingTeamIds.has((team as any).id)
      );
      if (result.skipped) {
        skipped++;
      } else {
        synced++;
        apiCalls++;
        await new Promise(r => setTimeout(r, delayMs));
      }
    } catch {
      failed++;
    }
  }

  logger.info(
    {
      teams: trackedTeams.length,
      synced,
      skipped,
      failed,
      apiCallsUsed: apiCalls,
    },
    'Tracked-league squad sync completed'
  );
  return { synced, skipped, failed, teams: trackedTeams.length };
}
