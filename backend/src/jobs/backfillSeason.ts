import { sportsApiClient } from '../services/sportsApiClient';
import { resolveEndpoint } from '../constants/endpoints';
import { matchesRepository } from '../repositories/MatchesRepository';
import { logger } from '../utils/logger';

/**
 * Historical Backfill Utility
 *
 * Phase 1 focuses on recent data (via daily schedule sync).
 * For backfilling historical data (2019-2023), use this utility.
 *
 * WARNING: Backfilling can be SLOW and EXPENSIVE (API quota).
 * Use carefully and monitor logs.
 *
 * Strategy:
 * 1. Backfill tournaments + seasons first
 * 2. Backfill schedule for target date range
 * 3. Sync team rosters for affected teams
 * 4. Process form for all matches
 */

export async function backfillScheduleRange(
  startDate: string,
  endDate: string,
  options?: {
    batchSize?: number;
    delayMs?: number;
    logProgress?: boolean;
  }
): Promise<{
  daysProcessed: number;
  totalMatches: number;
  errors: any[];
}> {
  const {
    batchSize = 1,
    delayMs = 100,
    logProgress = true,
  } = options || {};

  logger.warn(
    { startDate, endDate },
    'Starting historical backfill - this may take a while'
  );

  const start = new Date(startDate);
  const end = new Date(endDate);
  const current = new Date(start);

  let daysProcessed = 0;
  let totalMatches = 0;
  const errors = [];

  while (current <= end) {
    const dateStr = current.toISOString().split('T')[0];

    try {
      const endpoint = resolveEndpoint('schedule', { date: dateStr });
      const response = await sportsApiClient.get<any>(endpoint);

      const fixtures = response.response || [];
      totalMatches += fixtures.length;
      daysProcessed++;

      if (logProgress) {
        logger.info(
          { date: dateStr, matchesFound: fixtures.length },
          `Backfill progress: ${dateStr}`
        );
      }

      // Process this batch
      if (batchSize > 1 && daysProcessed % batchSize === 0) {
        logger.info(
          { daysProcessed, totalMatches },
          `Batch complete, sleeping ${delayMs}ms`
        );
        await sleep(delayMs);
      }
    } catch (error: any) {
      errors.push({
        date: dateStr,
        error: error.message,
      });

      logger.error(
        { date: dateStr, error: error.message },
        'Error backfilling date'
      );
    }

    // Move to next day
    current.setDate(current.getDate() + 1);
  }

  logger.info(
    { daysProcessed, totalMatches, errors: errors.length },
    'Backfill range completed'
  );

  return { daysProcessed, totalMatches, errors };
}

/**
 * Backfill specific season
 *
 * Example: backfillSeason(2023, 'Brazil', 'Serie B')
 */
export async function backfillSeason(
  year: number,
  country?: string,
  league?: string
): Promise<{
  matchesLoaded: number;
  error?: string;
}> {
  logger.warn(
    { year, country, league },
    'Starting season backfill'
  );

  try {
    // Season start/end dates (approximate)
    const startDate = `${year}-01-01`;
    const endDate = `${year}-12-31`;

    const result = await backfillScheduleRange(startDate, endDate, {
      batchSize: 1,
      delayMs: 500, // Slow down to avoid rate limits
      logProgress: true,
    });

    return { matchesLoaded: result.totalMatches };
  } catch (error: any) {
    logger.error(
      { year, error: error.message },
      'Season backfill failed'
    );
    return { matchesLoaded: 0, error: error.message };
  }
}

/**
 * Backfill multiple years
 *
 * Usage:
 * await backfillYears(2019, 2023, 'Brazil', 'Serie B')
 * Loads 2019, 2020, 2021, 2022, 2023
 */
export async function backfillYears(
  startYear: number,
  endYear: number,
  country?: string,
  league?: string
): Promise<{
  totalMatches: number;
  successCount: number;
  failureCount: number;
}> {
  logger.warn(
    { startYear, endYear, country, league },
    'Starting multi-year backfill'
  );

  let totalMatches = 0;
  let successCount = 0;
  let failureCount = 0;

  for (let year = startYear; year <= endYear; year++) {
    logger.info({ year }, `Backfilling year ${year}`);

    try {
      const result = await backfillSeason(year, country, league);

      if (result.error) {
        failureCount++;
      } else {
        totalMatches += result.matchesLoaded;
        successCount++;
      }

      // Sleep between years to avoid rate limits
      logger.info('Sleeping 2 minutes before next year...');
      await sleep(120000);
    } catch (error: any) {
      logger.error(
        { year, error: error.message },
        'Failed to backfill year'
      );
      failureCount++;
    }
  }

  logger.info(
    { totalMatches, successCount, failureCount },
    'Multi-year backfill completed'
  );

  return { totalMatches, successCount, failureCount };
}

/**
 * Estimate backfill cost
 *
 * Very rough estimate of API quota needed
 */
export function estimateBackfillCost(days: number): {
  estimatedRequests: number;
  estimatedHours: number;
  costWarning: string;
} {
  const requestsPerDay = 1; // 1 schedule request per day
  const totalRequests = days * requestsPerDay;
  const estimatedHours = (totalRequests * 0.5) / 60; // ~30 mins per 60 requests

  return {
    estimatedRequests: totalRequests,
    estimatedHours: Math.ceil(estimatedHours),
    costWarning:
      'Monitor your SportsAPI quota! Backfilling is expensive. Consider backfilling in small batches.',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Example usage:
 *
 * // Backfill 2023 season
 * const result = await backfillSeason(2023, 'Brazil', 'Serie B');
 * console.log(`Loaded ${result.matchesLoaded} matches`);
 *
 * // Backfill multiple years
 * const result = await backfillYears(2019, 2023, 'Brazil', 'Serie B');
 * console.log(`Loaded ${result.totalMatches} matches across ${result.successCount} years`);
 *
 * // Backfill specific date range
 * const result = await backfillScheduleRange('2023-08-01', '2023-12-31', {
 *   batchSize: 7,
 *   delayMs: 1000,
 *   logProgress: true
 * });
 * console.log(`Processed ${result.daysProcessed} days`);
 */
