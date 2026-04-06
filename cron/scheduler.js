const cron = require('node-cron');
const { runSync } = require('../sync');
const logger = require('../utils/logger');

// Default: run every 6 hours (at minute 0)
// Cron format: minute hour day month weekday
const SYNC_SCHEDULE = process.env.SYNC_CRON_SCHEDULE || '0 */6 * * *';

let syncInProgress = false;
let scheduledTask = null;

/**
 * Start the cron scheduler
 */
function startScheduler() {
  if (!cron.validate(SYNC_SCHEDULE)) {
    logger.error(`Invalid cron schedule: "${SYNC_SCHEDULE}"`);
    return;
  }

  logger.info(`Starting cron scheduler with schedule: "${SYNC_SCHEDULE}"`);

  scheduledTask = cron.schedule(SYNC_SCHEDULE, async () => {
    if (syncInProgress) {
      logger.warn('Sync already in progress, skipping this run');
      return;
    }

    syncInProgress = true;
    logger.info('Cron triggered: starting scheduled sync...');

    try {
      await runSync();
    } catch (error) {
      logger.error('Scheduled sync failed', { message: error.message });
    } finally {
      syncInProgress = false;
    }
  });

  logger.info('Cron scheduler started successfully');
}

/**
 * Stop the cron scheduler
 */
function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    logger.info('Cron scheduler stopped');
  }
}

/**
 * Check if a sync is currently running
 */
function isSyncInProgress() {
  return syncInProgress;
}

/**
 * Set sync in progress flag (used by manual trigger)
 */
function setSyncInProgress(value) {
  syncInProgress = value;
}

module.exports = {
  startScheduler,
  stopScheduler,
  isSyncInProgress,
  setSyncInProgress,
  SYNC_SCHEDULE,
};
