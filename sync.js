const katana = require('./services/katana');
const shopify = require('./services/shopify');
const logger = require('./utils/logger');

/**
 * Last sync result — stored in memory for status endpoint
 */
let lastSyncResult = null;

/**
 * Get the last sync result
 */
function getLastSyncResult() {
  return lastSyncResult;
}

/**
 * Main sync function
 *
 * Flow:
 * 1. Build arrival date map from Katana POs → { SKU: arrivalData }
 * 2. Fetch all products from Shopify (with variants)
 * 3. Loop through each Shopify variant:
 *    - Match variant's SKU against Katana arrival date map
 *    - If matched: update that variant's arrival metafields on Shopify
 *    - If no match: clear that variant's arrival metafields
 * 4. Log summary of results
 */
async function runSync() {
  const startTime = Date.now();
  logger.info('========== SYNC STARTED ==========');

  const results = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    duration: null,
    katanaSkus: 0,
    shopifyProducts: 0,
    shopifyVariants: 0,
    matched: 0,
    updated: 0,
    cleared: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  try {
    // Step 1: Build arrival date map from Katana PO data
    logger.info('Step 1: Building arrival date map from Katana...');
    const arrivalDateMap = await katana.buildArrivalDateMap();
    results.katanaSkus = Object.keys(arrivalDateMap).length;
    logger.info(`Katana arrival date map ready with ${results.katanaSkus} SKUs`);

    // Step 2: Fetch all Shopify products
    logger.info('Step 2: Fetching Shopify products...');
    const products = await shopify.fetchAllProducts();
    results.shopifyProducts = products.length;
    logger.info(`Fetched ${products.length} Shopify products`);

    // Step 3: Match and update per variant
    logger.info('Step 3: Matching SKUs and updating variant arrival metafields...');

    for (const product of products) {
      for (const variant of product.variants || []) {
        const sku = variant.sku;

        if (!sku) {
          results.skipped++;
          continue;
        }

        results.shopifyVariants++;
        const arrivalData = arrivalDateMap[sku];

        if (arrivalData) {
          // Has inbound PO → update this variant's arrival metafields
          results.matched++;
          try {
            await shopify.updateVariantArrivalMetafields(variant.id, arrivalData);
            results.updated++;
            const totalQty = arrivalData.totalInboundQty || arrivalData.expectedQty;
            logger.info(
              `Updated variant "${variant.title}" (ID: ${variant.id}, SKU: ${sku}) of "${product.title}" → Arrival: ${arrivalData.nextArrivalDate}, Total Inbound Qty: ${totalQty} (across ${arrivalData.openPOCount || 1} PO(s)), Nearest PO: ${arrivalData.poNumber}`
            );
          } catch (error) {
            results.failed++;
            const errMsg = `Failed to update variant "${variant.title}" (ID: ${variant.id}, SKU: ${sku}) of "${product.title}": ${error.message}`;
            results.errors.push(errMsg);
            logger.error(errMsg);
          }
        } else {
          // No inbound PO → clear this variant's arrival metafields
          try {
            await shopify.clearVariantArrivalMetafields(variant.id);
            results.cleared++;
            logger.info(
              `Cleared arrival metafields for variant "${variant.title}" (ID: ${variant.id}, SKU: ${sku}) of "${product.title}" — no inbound POs`
            );
          } catch (error) {
            results.failed++;
            const errMsg = `Failed to clear metafields for variant "${variant.title}" (ID: ${variant.id}, SKU: ${sku}) of "${product.title}": ${error.message}`;
            results.errors.push(errMsg);
            logger.error(errMsg);
          }
        }

        // Small delay to respect Shopify rate limits (2 requests/second for basic plan)
        await sleep(550);
      }
    }
  } catch (error) {
    results.errors.push(`Sync failed: ${error.message}`);
    logger.error('Sync failed with critical error', { message: error.message, stack: error.stack });
  }

  // Finalize results
  const endTime = Date.now();
  results.finishedAt = new Date().toISOString();
  results.duration = `${((endTime - startTime) / 1000).toFixed(1)}s`;

  // Store for status endpoint
  lastSyncResult = results;

  // Log summary
  logger.info('========== SYNC COMPLETE ==========');
  logger.info('Sync Summary', {
    duration: results.duration,
    katanaSkus: results.katanaSkus,
    shopifyProducts: results.shopifyProducts,
    shopifyVariants: results.shopifyVariants,
    matched: results.matched,
    updated: results.updated,
    cleared: results.cleared,
    skipped: results.skipped,
    failed: results.failed,
  });

  if (results.errors.length > 0) {
    logger.warn(`Sync completed with ${results.errors.length} error(s)`);
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
  runSync,
  getLastSyncResult,
};
