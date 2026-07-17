const axios = require('axios');
const logger = require('../utils/logger');

const SHIPSTATION_API_KEY = process.env.SHIPSTATION_API_KEY;
const SHIPSTATION_LOCATION_ID = process.env.SHIPSTATION_LOCATION_ID || 'se-4492637';

/**
 * Create an Axios instance for ShipStation V2 API
 * Auth: api-key header
 */
function getClient() {
  if (!SHIPSTATION_API_KEY) {
    throw new Error('SHIPSTATION_API_KEY is not set in environment variables');
  }

  return axios.create({
    baseURL: 'https://api.shipstation.com/v2',
    headers: {
      'Content-Type': 'application/json',
      'api-key': SHIPSTATION_API_KEY,
    },
  });
}

/**
 * Update inventory for a SKU in ShipStation
 * Uses the "adjust" transaction type to set exact quantity
 *
 * @param {string} sku - Product SKU
 * @param {number} quantity - Stock quantity to set
 */
async function updateInventory(sku, quantity) {
  const client = getClient();

  const response = await client.post('/inventory', {
    transaction_type: 'adjust',
    inventory_location_id: SHIPSTATION_LOCATION_ID,
    sku: sku,
    quantity: quantity,
    reason: 'Synced from Shopify',
  });

  return response.data;
}

/**
 * Get current inventory for a SKU from ShipStation
 *
 * @param {string} sku - Product SKU
 */
async function getInventory(sku) {
  const client = getClient();

  const response = await client.get('/inventory', {
    params: { sku },
  });

  return response.data;
}

/**
 * Get all warehouses from ShipStation
 */
async function getWarehouses() {
  const client = getClient();
  const response = await client.get('/warehouses');
  return response.data.warehouses || [];
}

module.exports = {
  updateInventory,
  getInventory,
  getWarehouses,
};
