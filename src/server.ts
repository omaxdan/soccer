import { logger } from './utils/logger';
import { config } from './config/index';
import { startCronScheduler, getScheduledJobs } from './jobs/cronOrchestrator';

/**
 * Application Entry Point
 *
 * Phase 1: Data Warehouse Foundation
 *
 * Responsibilities:
 * - Start Cron Job Scheduler
 * - Load and validate configuration
 * - Initialize database connections
 * - Keep application alive
 */
async function main() {
  logger.info({ env: config.node.env }, 'RIP Phase 1 - Starting');

  try {
    // Start cron scheduler
    const scheduledJobs = startCronScheduler();

    logger.info(
      {
        totalJobs: scheduledJobs.length,
        cronEnabled: config.cron.enabled,
        nodeEnv: config.node.env,
      },
      'Application initialized'
    );

    // Log available jobs
    const allJobs = getScheduledJobs();
    logger.info(
      {
        jobs: allJobs.map((j) => ({
          name: j.name,
          schedule: j.schedule,
          description: j.description,
        })),
      },
      'Available cron jobs'
    );

    // Keep process alive
    logger.info('RIP Phase 1 is running. Press Ctrl+C to stop.');

    process.on('SIGINT', () => {
      logger.info('Shutting down gracefully...');
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      logger.info('Shutting down gracefully...');
      process.exit(0);
    });
  } catch (error: any) {
    logger.error({ error: error.message }, 'Failed to start application');
    process.exit(1);
  }
}

main();
