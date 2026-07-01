import cron from 'node-cron';
import { logger } from '../utils/logger';
import { config } from '../config/index';
import { syncDateMasterFeed } from './syncDateMasterFeed';
import { syncSquadsForTrackedLeagues } from './syncTeamsPlayers';
import { processFormForRecentMatches } from './processForm';

interface CronJob {
  name: string;
  schedule: string;
  handler: () => Promise<any>;
  description: string;
}

const cronJobs: CronJob[] = [
  {
    name: 'masterFeedToday',
    schedule: '0 1 * * *',
    handler: async () => {
      const today = new Date().toISOString().split('T')[0];
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
      const r1 = await syncDateMasterFeed(today);
      await new Promise(r => setTimeout(r, 2000));
      const r2 = await syncDateMasterFeed(tomorrow);
      return { today: r1, tomorrow: r2 };
    },
    description: 'Master feed: 1 API call per day populates 8 tables',
  },
  {
    name: 'smartSquadSync',
    schedule: '0 3 * * *',
    handler: () => syncSquadsForTrackedLeagues(1200),
    description: 'Squad sync: tracked leagues only (~400-600 teams vs 3,756 global)',
  },
  {
    name: 'processFormRecent',
    schedule: '0 */6 * * *',
    handler: () => processFormForRecentMatches(24),
    description: 'Precompute team form for recently finished matches',
  },
];

/**
 * Start Cron Job Scheduler
 * 
 * Only starts if CRON_ENABLED=true
 */
export function startCronScheduler(): CronJob[] {
  if (!config.cron.enabled) {
    logger.info('Cron jobs are disabled (set CRON_ENABLED=true to enable)');
    return [];
  }

  logger.info({ jobCount: cronJobs.length }, 'Starting cron scheduler');

  const scheduledJobs: CronJob[] = [];

  for (const job of cronJobs) {
    try {
      cron.schedule(job.schedule, async () => {
        logger.info({ jobName: job.name }, `Cron job started: ${job.description}`);

        const startTime = Date.now();

        try {
          const result = await job.handler();
          const duration = Date.now() - startTime;

          logger.info(
            { jobName: job.name, duration, result },
            `Cron job succeeded`
          );
        } catch (error: any) {
          const duration = Date.now() - startTime;

          logger.error(
            { jobName: job.name, duration, error: error.message },
            `Cron job failed`
          );
        }
      });

      logger.debug(
        { jobName: job.name, schedule: job.schedule },
        `Cron job scheduled`
      );

      scheduledJobs.push(job);
    } catch (error: any) {
      logger.error(
        { jobName: job.name, error: error.message },
        'Failed to schedule cron job'
      );
    }
  }

  logger.info(
    { scheduledJobs: scheduledJobs.length },
    'Cron scheduler started'
  );

  return scheduledJobs;
}

/**
 * Get list of scheduled jobs
 */
export function getScheduledJobs(): CronJob[] {
  return cronJobs;
}

/**
 * Run a specific job immediately (for testing/manual trigger)
 */
export async function runJobNow(jobName: string): Promise<any> {
  const job = cronJobs.find((j) => j.name === jobName);

  if (!job) {
    throw new Error(`Job not found: ${jobName}`);
  }

  logger.info({ jobName }, 'Running job immediately');

  const startTime = Date.now();

  try {
    const result = await job.handler();
    const duration = Date.now() - startTime;

    logger.info(
      { jobName, duration, result },
      'Manual job execution succeeded'
    );

    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;

    logger.error(
      { jobName, duration, error: error.message },
      'Manual job execution failed'
    );

    throw error;
  }
}
