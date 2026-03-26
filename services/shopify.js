const axios = require('axios');
const logger = require('../utils/logger');

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-10';

/**
 * Create an Axios instance for Shopify Admin REST API
 * Auth: X-Shopify-Access-Token header
 */
function getClient() {
  if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN) {
    throw new Error('SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN must be set in environment variables');
  }

  return axios.create({
    baseURL: `https://${SHOPIFY_STORE_URL}/admin/api/${SHOPIFY_API_VERSION}`,
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN,
    },
  });
}

// ─── Fetch Products ──────────────────────────────────────────

/**
 * Fetch all products from Shopify (handles Link header pagination)
 * Returns products with their variants (each variant has a sku)
 */
async function fetchAllProducts() {
  logger.info('Fetching all products from Shopify...');

  const client = getClient();
  let allProducts = [];
  let url = '/products.json?limit=250';

  while (url) {
    try {
      const response = await client.get(url);
      const products = response.data.products || [];
      allProducts = allProducts.concat(products);

      // Shopify pagination via Link header
      const linkHeader = response.headers['link'] || response.headers['Link'] || '';
      const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);

      if (nextMatch) {
        const nextUrl = new URL(nextMatch[1]);
        url = nextUrl.pathname.replace(`/admin/api/${SHOPIFY_API_VERSION}`, '') + nextUrl.search;
      } else {
        url = null;
      }
    } catch (error) {
      logger.error('Failed to fetch products from Shopify', {
        status: error.response?.status,
        message: error.response?.data?.errors || error.message,
      });
      throw error;
    }
  }

  logger.info(`Fetched ${allProducts.length} products from Shopify`);
  return allProducts;
}

// ─── Variant Metafield Operations ────────────────────────────

/**
 * Set multiple metafields on a Shopify variant in one call
 *
 * @param {number} variantId - Shopify variant ID
 * @param {Array} metafields - Array of { namespace, key, value, type }
 */
async function setVariantMetafields(variantId, metafields) {
  const client = getClient();

  try {
    const results = [];

    for (const mf of metafields) {
      try {
        const response = await client.post(`/variants/${variantId}/metafields.json`, {
          metafield: {
            namespace: mf.namespace,
            key: mf.key,
            value: String(mf.value),
            type: mf.type,
          },
        });
        results.push(response.data.metafield);
      } catch (err) {
        // 422 usually means metafield already exists — find and update
        if (err.response?.status === 422) {
          const updated = await findAndUpdateVariantMetafield(variantId, mf);
          results.push(updated);
        } else {
          throw err;
        }
      }
    }

    return results;
  } catch (error) {
    logger.error(`Failed to set metafields for variant ${variantId}`, {
      status: error.response?.status,
      message: error.response?.data?.errors || error.message,
    });
    throw error;
  }
}

/**
 * Find an existing variant metafield and update its value
 */
async function findAndUpdateVariantMetafield(variantId, mf) {
  const client = getClient();

  const listResponse = await client.get(
    `/variants/${variantId}/metafields.json?namespace=${mf.namespace}&key=${mf.key}`
  );

  const existing = (listResponse.data.metafields || [])
    .find((m) => m.namespace === mf.namespace && m.key === mf.key);

  if (existing) {
    const updateResponse = await client.put(
      `/variants/${variantId}/metafields/${existing.id}.json`,
      {
        metafield: {
          id: existing.id,
          value: String(mf.value),
          type: mf.type,
        },
      }
    );
    return updateResponse.data.metafield;
  }

  // Metafield not found — retry create
  const createResponse = await client.post(`/variants/${variantId}/metafields.json`, {
    metafield: {
      namespace: mf.namespace,
      key: mf.key,
      value: String(mf.value),
      type: mf.type,
    },
  });
  return createResponse.data.metafield;
}

// ─── Variant Arrival Date Metafield Helpers ──────────────────

/**
 * Update arrival-date-related metafields on a Shopify variant
 *
 * Metafields written:
 *   custom.next_expected_arrival_date  (date)     — e.g. "2026-03-15"
 *   custom.next_expected_quantity      (integer)  — e.g. 85
 *   custom.next_expected_po_id         (string)   — e.g. "PO-42"
 *
 * @param {number} variantId - Shopify variant ID
 * @param {object} arrivalData - { nextArrivalDate, expectedQty, poNumber }
 */
async function updateVariantArrivalMetafields(variantId, arrivalData) {
  const totalQty = arrivalData.totalInboundQty || arrivalData.expectedQty;

  const metafields = [
    {
      namespace: 'custom',
      key: 'next_expected_arrival_date',
      value: formatDateForShopify(arrivalData.nextArrivalDate),
      type: 'date',
    },
    {
      namespace: 'custom',
      key: 'next_expected_quantity',
      value: Math.floor(totalQty),
      type: 'number_integer',
    },
    {
      namespace: 'custom',
      key: 'next_expected_po_id',
      value: arrivalData.poNumber || String(arrivalData.poId),
      type: 'single_line_text_field',
    },
  ];

  return setVariantMetafields(variantId, metafields);
}

/**
 * Clear arrival metafields on a variant when no open POs exist
 * Deletes the metafields entirely — Shopify does not allow blank values
 *
 * @param {number} variantId - Shopify variant ID
 */
async function clearVariantArrivalMetafields(variantId) {
  const client = getClient();
  const keysToDelete = [
    'next_expected_arrival_date',
    'next_expected_quantity',
    'next_expected_po_id',
  ];

  // Fetch existing metafields for this variant in the 'custom' namespace
  const response = await client.get(
    `/variants/${variantId}/metafields.json?namespace=custom`
  );
  const existing = response.data.metafields || [];

  // Delete each arrival-related metafield that exists
  for (const mf of existing) {
    if (keysToDelete.includes(mf.key)) {
      await client.delete(`/variants/${variantId}/metafields/${mf.id}.json`);
    }
  }
}

/**
 * Format an ISO date string to Shopify date format (YYYY-MM-DD)
 */
function formatDateForShopify(isoDateString) {
  if (!isoDateString) return '';
  const date = new Date(isoDateString);
  return date.toISOString().split('T')[0]; // "2026-03-15"
}

module.exports = {
  fetchAllProducts,
  setVariantMetafields,
  updateVariantArrivalMetafields,
  clearVariantArrivalMetafields,
};
