const axios = require('axios');
const logger = require('../utils/logger');

const KATANA_BASE_URL = process.env.KATANA_API_BASE_URL || 'https://api.katanamrp.com/v1';
const KATANA_API_KEY = process.env.KATANA_API_KEY;

/**
 * Create an Axios instance for Katana API
 * Auth: Bearer token in Authorization header
 */
function getClient() {
  if (!KATANA_API_KEY) {
    throw new Error('KATANA_API_KEY is not set in environment variables');
  }

  return axios.create({
    baseURL: KATANA_BASE_URL,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${KATANA_API_KEY}`,
    },
  });
}

/**
 * Fetch all pages from a paginated Katana endpoint
 * Katana uses cursor-based pagination with a "next" link
 */
async function fetchAllPages(endpoint, params = {}) {
  const client = getClient();
  let allData = [];
  let page = 1;

  while (true) {
    try {
      const response = await client.get(endpoint, {
        params: { ...params, page },
      });
      const { data } = response;

      if (data && data.data) {
        allData = allData.concat(data.data);
      }

      // Katana uses x-pagination response header for pagination
      const paginationHeader = response.headers['x-pagination'];
      if (paginationHeader) {
        const pagination = JSON.parse(paginationHeader);
        if (pagination.last_page === 'true' || pagination.last_page === true) {
          break;
        }
        page++;
      } else {
        break;
      }
    } catch (error) {
      logger.error(`Failed to fetch ${endpoint} (page ${page})`, {
        status: error.response?.status,
        message: error.response?.data?.message || error.message,
      });
      throw error;
    }
  }

  return allData;
}

// ─── Variants ────────────────────────────────────────────────

/**
 * Fetch all variants from Katana
 * Variants contain the SKU field — our matching key to Shopify
 *
 * Expected fields: id, sku, name, product_id, ...
 */
async function fetchAllVariants() {
  logger.info('Fetching all variants from Katana...');
  const variants = await fetchAllPages('/variants');
  logger.info(`Fetched ${variants.length} variants from Katana`);
  return variants;
}

// ─── Purchase Orders ─────────────────────────────────────────

/**
 * Fetch all purchase orders from Katana
 *
 * Expected PO fields:
 *   id, po_no, status, expected_arrival_date, supplier_id,
 *   created_at, updated_at, purchase_order_rows [...]
 *
 * PO statuses (expected): NOT_RECEIVED, PARTIALLY_RECEIVED, RECEIVED
 */
async function fetchAllPurchaseOrders() {
  logger.info('Fetching all purchase orders from Katana...');
  const purchaseOrders = await fetchAllPages('/purchase_orders');
  logger.info(`Fetched ${purchaseOrders.length} purchase orders from Katana`);
  return purchaseOrders;
}

/**
 * Fetch all purchase order rows from Katana
 *
 * Expected PO row fields:
 *   id, purchase_order_id, variant_id, quantity, received_quantity,
 *   price_per_unit, ...
 */
async function fetchAllPurchaseOrderRows() {
  logger.info('Fetching all purchase order rows from Katana...');
  const rows = await fetchAllPages('/purchase_order_rows');
  logger.info(`Fetched ${rows.length} purchase order rows from Katana`);
  return rows;
}

// ─── Build Arrival Date Map ──────────────────────────────────

/**
 * Build a map of next expected arrival data per SKU
 *
 * Flow:
 * 1. Fetch all variants → { variant_id: sku }
 * 2. Fetch all purchase orders → filter to open POs (NOT_RECEIVED, PARTIALLY_RECEIVED)
 * 3. Fetch all purchase order rows → filter to rows with remaining qty
 * 4. For each open PO row, look up the parent PO's expected_arrival_date
 * 5. Group by SKU, pick the earliest arrival date
 *
 * Returns: {
 *   "SKU-123": {
 *     nextArrivalDate: "2026-03-15T00:00:00.000Z",
 *     expectedQty: 85,
 *     poNumber: "PO-42",
 *     poId: 12345
 *   },
 *   ...
 * }
 */
async function buildArrivalDateMap() {
  logger.info('Building arrival date map from Katana PO data...');

  // Step 1: Fetch variants, POs, and PO rows in parallel
  const [variants, purchaseOrders, poRows] = await Promise.all([
    fetchAllVariants(),
    fetchAllPurchaseOrders(),
    fetchAllPurchaseOrderRows(),
  ]);

  // Build variant_id → SKU lookup
  const variantSkuLookup = {};
  for (const v of variants) {
    if (v.sku) {
      variantSkuLookup[v.id] = v.sku;
    }
  }
  logger.info(`${Object.keys(variantSkuLookup).length} variants with SKUs`);

  // Step 2: Build PO lookup — only open POs (not fully received)
  const openPOs = {};
  for (const po of purchaseOrders) {
    const status = (po.status || '').toUpperCase();
    if (status === 'RECEIVED') {
      continue; // Skip fully received POs
    }
    openPOs[po.id] = {
      id: po.id,
      poNumber: po.po_no || po.order_no || `PO-${po.id}`,
      expectedArrivalDate: po.expected_arrival_date || null,
      status,
    };
  }
  logger.info(`${Object.keys(openPOs).length} open purchase orders found`);

  // Step 3: Process PO rows — find rows with remaining qty in open POs
  // remainingQty = quantity - received_quantity (field names may vary)
  const arrivalsBysku = {};

  for (const row of poRows) {
    const poId = row.purchase_order_id;
    const variantId = row.variant_id;

    // Skip if PO is not open
    const po = openPOs[poId];
    if (!po) continue;

    // Skip if no arrival date on this PO
    if (!po.expectedArrivalDate) continue;

    // Skip if variant has no SKU
    const sku = variantSkuLookup[variantId];
    if (!sku) continue;

    // Calculate remaining quantity
    const ordered = parseFloat(row.quantity) || 0;
    const received = parseFloat(row.received_quantity) || 0;
    const remaining = ordered - received;

    if (remaining <= 0) continue; // Fully received row

    const arrivalDate = new Date(po.expectedArrivalDate);

    // Track all open arrivals for this SKU
    if (!arrivalsBysku[sku]) {
      arrivalsBysku[sku] = [];
    }

    arrivalsBysku[sku].push({
      arrivalDate,
      arrivalDateISO: po.expectedArrivalDate,
      expectedQty: remaining,
      poNumber: po.poNumber,
      poId: po.id,
    });
  }

  // Step 4: For each SKU, pick the earliest arrival date
  const arrivalDateMap = {};

  for (const [sku, arrivals] of Object.entries(arrivalsBysku)) {
    // Sort by arrival date ascending
    arrivals.sort((a, b) => a.arrivalDate - b.arrivalDate);

    const earliest = arrivals[0];
    arrivalDateMap[sku] = {
      nextArrivalDate: earliest.arrivalDateISO,
      expectedQty: earliest.expectedQty,
      poNumber: earliest.poNumber,
      poId: earliest.poId,
      totalInboundQty: arrivals.reduce((sum, a) => sum + a.expectedQty, 0),
      openPOCount: arrivals.length,
    };
  }

  logger.info(`Arrival date map built: ${Object.keys(arrivalDateMap).length} SKUs with inbound POs`);
  return arrivalDateMap;
}

module.exports = {
  fetchAllVariants,
  fetchAllPurchaseOrders,
  fetchAllPurchaseOrderRows,
  buildArrivalDateMap,
};
