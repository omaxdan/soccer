import { sportsApiClient } from '../services/sportsApiClient';
import { resolveEndpoint } from '../constants/endpoints';
import { matchesRepository, matchResultsRepository } from '../repositories/MatchesRepository';
import { teamsRepository } from '../repositories/TeamsRepository';
import { transformMatch, transformMatchResult } from '../transformers/index';
import { logger } from '../utils/logger';
import { SportsAPIMatch } from '../types/index';

/**
 * Sync Schedule for a specific date
 *
 * Responsibilities:
 * 1. Fetch fixtures from SportsAPI Pro for a given date
 * 2. Discover and upsert teams
 * 3. Upsert match records
 * 4. Initialize match_results records
 *
 * This is an idempotent job - safe to run multiple times.
 */
export async function syncSchedule(date: string): Promise<{
  matchesProcessed: number;
  teamsDiscovered: number;
  error?: string;
}> {
  logger.info({ date }, 'Starting schedule sync');

  try {
    const endpoint = resolveEndpoint('schedule', { date });
    const response = await sportsApiClient.get<any>(endpoint);

    const fixtures = response.events || response.data?.events || [];
    logger.info({ count: fixtures.length, date }, 'Fetched fixtures');

    if (fixtures.length === 0) {
      logger.info({ date }, 'No fixtures found for this date');
      return { matchesProcessed: 0, teamsDiscovered: 0 };
    }

    // ── Extract unique teams ──────────────────────────────
    const teamMap = new Map<number, any>();
    const matchesData: any[] = [];

    for (const fixture of fixtures) {
      if (fixture.homeTeam?.id) teamMap.set(fixture.homeTeam.id, fixture.homeTeam);
      if (fixture.awayTeam?.id) teamMap.set(fixture.awayTeam.id, fixture.awayTeam);
      matchesData.push(fixture);
    }

    // ── Upsert teams ──────────────────────────────────────
    logger.debug({ teamCount: teamMap.size }, 'Upserting teams from schedule');
    const teamsArray = Array.from(teamMap.values());
    const transformedTeams: any[] = teamsArray.map((t: any) => ({
      external_id: t.id,
      name: t.name,
      short_name: t.shortName || null,           // ✅ correct field
      country: t.country?.name || null,           // ✅ extract country name
      slug: t.name.toLowerCase().replace(/\s+/g, '-'),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    await teamsRepository.upsertBatch(transformedTeams);

    // ── Load all teams in ONE query (batch lookup) ────────
    const uniqueTeamExtIds = new Set<number>();
    for (const fixture of matchesData) {
      if (fixture.homeTeam?.id) uniqueTeamExtIds.add(fixture.homeTeam.id);
      if (fixture.awayTeam?.id) uniqueTeamExtIds.add(fixture.awayTeam.id);
    }

    const teamIdMap = new Map<number, any>();
    if (uniqueTeamExtIds.size > 0) {
      const teamsBatch = await teamsRepository.findByExternalIds(
        Array.from(uniqueTeamExtIds)
      );
      for (const team of teamsBatch) {
        teamIdMap.set(team.external_id, team);
      }
    }

    // ── Transform matches & build results ─────────────────
    logger.debug({ matchCount: matchesData.length }, 'Transforming matches');
    const matches = [];
    const matchResults = [];

    for (const fixture of matchesData) {
      const homeTeam = teamIdMap.get(fixture.homeTeam?.id);
      const awayTeam = teamIdMap.get(fixture.awayTeam?.id);

      if (!homeTeam || !awayTeam) {
        logger.warn(
          {
            matchId: fixture.id,
            homeTeamExt: fixture.homeTeam?.id,
            awayTeamExt: fixture.awayTeam?.id,
          },
          'Could not resolve team IDs for match'
        );
        continue;
      }

      const match = transformMatch(fixture);
      match.home_team_id = homeTeam.id;
      match.away_team_id = awayTeam.id;

      matches.push(match);

      // Create match result record (winner_team_id set later)
      const matchResult = transformMatchResult(match.id, fixture);
      matchResult.match_id = 0; // placeholder
      matchResults.push({ fixture, matchResult, homeTeam, awayTeam });
    }

    // ── Batch upsert matches ──────────────────────────────
    await matchesRepository.upsertBatch(matches);
    logger.info({ count: matches.length }, 'Upserted matches');

    // ── Resolve match IDs and winner, upsert results ──────
    for (const { fixture, matchResult, homeTeam, awayTeam } of matchResults) {
      const match = await matchesRepository.findByExternalId(fixture.id);
      if (!match) {
        logger.warn({ externalId: fixture.id }, 'Match not found after upsert');
        continue;
      }
      matchResult.match_id = match.id;

      // Set winner using the already-fetched team objects
      if (fixture.winnerCode === 1) {
        matchResult.winner_team_id = homeTeam.id;
      } else if (fixture.winnerCode === 2) {
        matchResult.winner_team_id = awayTeam.id;
      } else {
        matchResult.winner_team_id = null;
      }

      await matchResultsRepository.upsert(matchResult);
    }

    logger.info(
      { matchesProcessed: matches.length, teamsDiscovered: teamMap.size },
      'Schedule sync completed'
    );

    return {
      matchesProcessed: matches.length,
      teamsDiscovered: teamMap.size,
    };
  } catch (error: any) {
    const errorMessage = error.message || 'Unknown error';
    logger.error({ error: errorMessage, date }, 'Schedule sync failed');
    return {
      matchesProcessed: 0,
      teamsDiscovered: 0,
      error: errorMessage,
    };
  }
}