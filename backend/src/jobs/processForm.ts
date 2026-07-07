import { matchesRepository, matchResultsRepository } from '../repositories/MatchesRepository';
import { teamFormHistoryRepository } from '../repositories/TeamFormHistoryRepository';
import { teamsRepository } from '../repositories/TeamsRepository';
import { logger } from '../utils/logger';
import { TeamFormHistory } from '../types/index';

/**
 * Process Form for a Match
 *
 * When a match finishes, this job:
 * 1. Reads the match result (home score, away score)
 * 2. Determines result (W/D/L) for each team
 * 3. Calculates points (3/1/0)
 * 4. Creates team_form_history records
 *
 * This is the ONLY Phase 1 processing job.
 * All other intelligence (readiness, fatigue, etc) comes in Phase 2+.
 *
 * Idempotent - safe to run multiple times.
 */
export async function processFormForMatch(
  matchId: number
): Promise<{
  homeFormRecordId: number | null;
  awayFormRecordId: number | null;
}> {
  logger.debug({ matchId }, 'Processing form for match');

  try {
    // Fetch match and result
    const match = await matchesRepository.findById(matchId);
    if (!match) {
      logger.warn({ matchId }, 'Match not found');
      return { homeFormRecordId: null, awayFormRecordId: null };
    }

    const result = await matchResultsRepository.findByMatchId(matchId);
    if (!result) {
      logger.warn({ matchId }, 'Match result not found');
      return { homeFormRecordId: null, awayFormRecordId: null };
    }

    // If match hasn't finished, skip
    if (result.status !== 'finished' && result.home_score === null) {
      logger.debug({ matchId }, 'Match not finished, skipping form processing');
      return { homeFormRecordId: null, awayFormRecordId: null };
    }

    const homeScore = result.home_score ?? 0;
    const awayScore = result.away_score ?? 0;
    const htHomeScore = result.half_time_home_score ?? null;
    const htAwayScore = result.half_time_away_score ?? null;
    const btts       = homeScore > 0 && awayScore > 0;

    // Determine home result and points
    let homeResult = 'D';
    let homePoints = 1;
    let awayResult = 'D';
    let awayPoints = 1;

    if (homeScore > awayScore) {
      homeResult = 'W';
      homePoints = 3;
      awayResult = 'L';
      awayPoints = 0;
    } else if (awayScore > homeScore) {
      homeResult = 'L';
      homePoints = 0;
      awayResult = 'W';
      awayPoints = 3;
    }

    // Create form records
    const homeFormRecord: TeamFormHistory = {
      id: 0,
      team_id: match.home_team_id,
      match_id: match.id,
      match_date: match.date,  // denormalized — see migration 007
      result: homeResult,
      goals_for: homeScore,
      goals_against: awayScore,
      points: homePoints,
      // ── migration 021 enrichment fields ──
      is_home: true,
      half_time_score_for:     htHomeScore,
      half_time_score_against: htAwayScore,
      btts,
      created_at: new Date().toISOString(),
    };

    const awayFormRecord: TeamFormHistory = {
      id: 0,
      team_id: match.away_team_id,
      match_id: match.id,
      match_date: match.date,  // denormalized — see migration 007
      result: awayResult,
      goals_for: awayScore,
      goals_against: homeScore,
      points: awayPoints,
      // ── migration 021 enrichment fields ──
      is_home: false,
      half_time_score_for:     htAwayScore,
      half_time_score_against: htHomeScore,
      btts,
      created_at: new Date().toISOString(),
    };

    // Upsert both records
    const homeResult_db = await teamFormHistoryRepository.upsert(homeFormRecord);
    const awayResult_db = await teamFormHistoryRepository.upsert(awayFormRecord);

    logger.info(
      {
        matchId,
        homeTeamId: match.home_team_id,
        awayTeamId: match.away_team_id,
        homeResult,
        awayResult,
      },
      'Form records created'
    );

    return {
      homeFormRecordId: homeResult_db.id,
      awayFormRecordId: awayResult_db.id,
    };
  } catch (error: any) {
    logger.error(
      { error: error.message, matchId },
      'Failed to process form for match'
    );
    throw error;
  }
}

/**
 * Process Form for Recently Finished Matches
 *
 * Scans for matches with status 'finished' that don't have form records yet.
 */
export async function processFormForRecentMatches(
  hoursBack: number = 24
): Promise<{
  matchesProcessed: number;
  failures: any[];
}> {
  logger.info({ hoursBack }, 'Processing form for recent matches');

  try {
    // Get all finished matches
    const finishedMatches = await matchesRepository.getFinishedMatches(1000);

    const processedMatches = [];
    const failures = [];

    for (const match of finishedMatches) {
      try {
        // Check if form already exists
        const exists = await teamFormHistoryRepository.existsForMatch(match.id);
        if (exists) {
          continue; // Already processed
        }

        await processFormForMatch(match.id);
        processedMatches.push(match.id);
      } catch (error: any) {
        failures.push({
          matchId: match.id,
          error: error.message,
        });
      }
    }

    logger.info(
      { matchesProcessed: processedMatches.length, failures: failures.length },
      'Form processing batch completed'
    );

    return {
      matchesProcessed: processedMatches.length,
      failures,
    };
  } catch (error: any) {
    logger.error(
      { error: error.message },
      'Failed to process form batch'
    );
    throw error;
  }
}

/**
 * Process Form for All Finished Matches (Backfill)
 *
 * Use this to backfill form history for all finished matches in the DB.
 * WARNING: Can be slow if large dataset.
 */
export async function processFormBackfill(): Promise<{
  totalMatches: number;
  successCount: number;
  failureCount: number;
}> {
  logger.warn('Starting form history backfill - this may take a while');

  const finishedMatches = await matchesRepository.getFinishedMatches(10000);
  let successCount = 0;
  let failureCount = 0;

  for (const match of finishedMatches) {
    try {
      // Skip if already exists
      const exists = await teamFormHistoryRepository.existsForMatch(match.id);
      if (!exists) {
        await processFormForMatch(match.id);
        successCount++;
      }
    } catch (error) {
      failureCount++;
      logger.error(
        { matchId: match.id, error },
        'Failed to process match form'
      );
    }
  }

  logger.info(
    { totalMatches: finishedMatches.length, successCount, failureCount },
    'Form backfill completed'
  );

  return {
    totalMatches: finishedMatches.length,
    successCount,
    failureCount,
  };
}
