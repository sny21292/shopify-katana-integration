const cron = require('node-cron');
const { runSync } = require('../sync');
const { runInventorySync } = require('../inventory-sync');
const logger = require('../utils/logger');

// Default: run every 6 hours (at minute 0)
// Cron format: minute hour day month weekday
const SYNC_SCHEDULE = process.env.SYNC_CRON_SCHEDULE || '0 */6 * * *';
const INVENTORY_SYNC_SCHEDULE = process.env.INVENTORY_SYNC_CRON_SCHEDULE || '*/15 * * * *';

let syncInProgress = false;
let inventorySyncInProgress = false;
let scheduledTask = null;
let inventoryScheduledTask = null;

/**
 * Start the cron scheduler (Katana PO sync)
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

  // Start inventory sync scheduler
  startInventoryScheduler();
}

/**
 * Start the inventory sync cron scheduler (Shopify → ShipStation)
 */
function startInventoryScheduler() {
  if (!cron.validate(INVENTORY_SYNC_SCHEDULE)) {
    logger.error(`Invalid inventory sync cron schedule: "${INVENTORY_SYNC_SCHEDULE}"`);
    return;
  }

  logger.info(`Starting inventory sync scheduler with schedule: "${INVENTORY_SYNC_SCHEDULE}"`);

  inventoryScheduledTask = cron.schedule(INVENTORY_SYNC_SCHEDULE, async () => {
    if (inventorySyncInProgress) {
      logger.warn('Inventory sync already in progress, skipping this run');
      return;
    }

    inventorySyncInProgress = true;
    logger.info('Cron triggered: starting scheduled inventory sync...');

    try {
      await runInventorySync();
    } catch (error) {
      logger.error('Scheduled inventory sync failed', { message: error.message });
    } finally {
      inventorySyncInProgress = false;
    }
  });

  logger.info('Inventory sync scheduler started successfully');
}

/**
 * Stop the cron scheduler
 */
function stopScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
    logger.info('Cron scheduler stopped');
  }
  if (inventoryScheduledTask) {
    inventoryScheduledTask.stop();
    logger.info('Inventory sync scheduler stopped');
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

/**
 * Check if inventory sync is currently running
 */
function isInventorySyncInProgress() {
  return inventorySyncInProgress;
}

/**
 * Set inventory sync in progress flag
 */
function setInventorySyncInProgress(value) {
  inventorySyncInProgress = value;
}

module.exports = {
  startScheduler,
  stopScheduler,
  isSyncInProgress,
  setSyncInProgress,
  isInventorySyncInProgress,
  setInventorySyncInProgress,
  SYNC_SCHEDULE,
  INVENTORY_SYNC_SCHEDULE,
};
