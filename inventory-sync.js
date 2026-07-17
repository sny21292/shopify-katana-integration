const shopify = require('./services/shopify');
const shipstation = require('./services/shipstation');
const logger = require('./utils/logger');

/**
 * Last inventory sync result — stored in memory for status endpoint
 */
let lastInventorySyncResult = null;

/**
 * Get the last inventory sync result
 */
function getLastInventorySyncResult() {
  return lastInventorySyncResult;
}

/**
 * Main inventory sync function
 *
 * Flow:
 * 1. Fetch all products from Shopify (with variants and inventory)
 * 2. For each variant with a SKU:
 *    - Get inventory_quantity from Shopify
 *    - Push to ShipStation via API
 * 3. Log summary
 */
async function runInventorySync() {
  const startTime = Date.now();
  logger.info('========== INVENTORY SYNC STARTED ==========');

  const results = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    duration: null,
    shopifyProducts: 0,
    shopifyVariants: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  try {
    // Step 1: Fetch all Shopify products
    logger.info('Step 1: Fetching Shopify products...');
    const products = await shopify.fetchAllProducts();
    results.shopifyProducts = products.length;
    logger.info(`Fetched ${products.length} Shopify products`);

    // Step 2: Loop through each variant and push to ShipStation
    logger.info('Step 2: Syncing inventory to ShipStation...');

    for (const product of products) {
      for (const variant of product.variants || []) {
        const sku = variant.sku;

        if (!sku) {
          results.skipped++;
          continue;
        }

        results.shopifyVariants++;
        const quantity = Math.max(0, variant.inventory_quantity || 0);

        try {
          await shipstation.updateInventory(sku, quantity);
          results.updated++;
          logger.info(
            `Updated "${product.title}" (SKU: ${sku}) → Stock: ${quantity}`
          );
        } catch (error) {
          results.failed++;
          const errMsg = `Failed to update "${product.title}" (SKU: ${sku}): ${error.response?.data?.errors?.[0]?.message || error.message}`;
          results.errors.push(errMsg);
          logger.error(errMsg);
        }

        // Rate limit: ShipStation allows 40 requests/min = 1.5s between calls
        await sleep(1500);
      }
    }
  } catch (error) {
    results.errors.push(`Inventory sync failed: ${error.message}`);
    logger.error('Inventory sync failed with critical error', { message: error.message, stack: error.stack });
  }

  // Finalize results
  const endTime = Date.now();
  results.finishedAt = new Date().toISOString();
  results.duration = `${((endTime - startTime) / 1000).toFixed(1)}s`;

  // Store for status endpoint
  lastInventorySyncResult = results;

  // Log summary
  logger.info('========== INVENTORY SYNC COMPLETE ==========');
  logger.info('Inventory Sync Summary', {
    duration: results.duration,
    shopifyProducts: results.shopifyProducts,
    shopifyVariants: results.shopifyVariants,
    updated: results.updated,
    skipped: results.skipped,
    failed: results.failed,
  });

  if (results.errors.length > 0) {
    logger.warn(`Inventory sync completed with ${results.errors.length} error(s)`);
  }

  return results;
}

/**
 * Sleep helper for rate limiting
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  runInventorySync,
  getLastInventorySyncResult,
};
