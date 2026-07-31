const shopify = require('./services/shopify');
const shipstation = require('./services/shipstation');
const katana = require('./services/katana');
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
 * 1. Fetch all products from Shopify (for the SKU list)
 * 2. Fetch on-hand stock per SKU from Shopify (Katana as fallback)
 * 3. For each variant with a SKU, push the on-hand quantity to ShipStation
 * 4. Log summary
 *
 * Stock source: Shopify's ON HAND (GraphQL inventoryLevels, needs the
 * read_inventory scope) — the same figure the Shopify admin shows. NOT the
 * variant's inventory_quantity field, which is "available" (on hand -
 * committed). Available goes negative on oversold products and gets floored
 * to 0, which made ShipStation block shipments for units that were physically
 * sitting in the warehouse.
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
    katanaSkus: 0,
    shopifyOnHandSkus: 0,
    fellBackToKatana: 0,
    fellBackToShopifyAvailable: 0,
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

    // Step 2: Fetch on-hand stock per SKU — Shopify is the source of truth.
    // Katana is loaded as a fallback for SKUs Shopify doesn't report.
    logger.info('Step 2: Fetching on-hand stock from Shopify...');
    const onHandBySku = await shopify.fetchOnHandBySku();
    results.shopifyOnHandSkus = Object.keys(onHandBySku).length;

    logger.info('Step 2b: Fetching Katana on-hand as fallback...');
    const katanaOnHandBySku = await katana.buildOnHandMap();
    results.katanaSkus = Object.keys(katanaOnHandBySku).length;

    // Step 3: Loop through each variant and push to ShipStation
    logger.info('Step 3: Syncing inventory to ShipStation...');

    for (const product of products) {
      for (const variant of product.variants || []) {
        const sku = variant.sku;

        if (!sku) {
          results.skipped++;
          continue;
        }

        results.shopifyVariants++;

        // Stock sent to ShipStation is Shopify's ON HAND — the physical count.
        // Not "available" (on hand - committed), which goes negative on
        // oversold products and would block units sitting in the warehouse.
        //
        // Fallback order, so no SKU ends up worse off than before:
        //   1. Shopify on hand   — source of truth, matches the admin UI
        //   2. Katana on hand    — for SKUs Shopify doesn't report a level for
        //   3. Shopify available — original behaviour, last resort
        const shopifyOnHand = onHandBySku[sku];
        const katanaOnHand = katanaOnHandBySku[sku];
        const shopifyAvailable = Math.max(0, variant.inventory_quantity || 0);
        let quantity;

        if (shopifyOnHand !== undefined && shopifyOnHand > 0) {
          quantity = Math.floor(shopifyOnHand);
        } else if (shopifyOnHand === 0) {
          // Genuinely out of stock in Shopify — send 0, don't mask it with
          // a stale figure from another system.
          quantity = 0;
        } else if (katanaOnHand !== undefined && katanaOnHand > 0) {
          results.fellBackToKatana++;
          quantity = Math.floor(katanaOnHand);
        } else {
          results.fellBackToShopifyAvailable++;
          quantity = shopifyAvailable;
        }

        try {
          await shipstation.updateInventory(sku, quantity);
          results.updated++;
          logger.info(
            `Updated "${product.title}" (SKU: ${sku}) → On hand: ${quantity}`
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
    katanaSkus: results.katanaSkus,
    updated: results.updated,
    skipped: results.skipped,
    shopifyOnHandSkus: results.shopifyOnHandSkus,
    fellBackToKatana: results.fellBackToKatana,
    fellBackToShopifyAvailable: results.fellBackToShopifyAvailable,
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
