const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

const KATANA_BASE_URL = process.env.KATANA_API_BASE_URL || 'https://api.katanamrp.com/v1';
const KATANA_API_KEY = process.env.KATANA_API_KEY;
const WEBHOOK_CALLBACK_URL = process.env.WEBHOOK_CALLBACK_URL;
const KATANA_WEBHOOK_TOKEN = process.env.KATANA_WEBHOOK_TOKEN;

const PO_EVENTS = [
  'purchase_order.created',
  'purchase_order.updated',
  'purchase_order.deleted',
  'purchase_order.partially_received',
  'purchase_order.received',
  'purchase_order_row.created',
  'purchase_order_row.updated',
  'purchase_order_row.deleted',
  'purchase_order_row.received',
];

function getClient() {
  if (!KATANA_API_KEY) {
    throw new Error('KATANA_API_KEY is not set in environment variables');
  }

  return axios.create({
    baseURL: KATANA_BASE_URL,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bearer ${KATANA_API_KEY}`,
    },
  });
}

/**
 * List all existing webhooks registered with Katana
 */
async function listWebhooks() {
  const client = getClient();

  try {
    const response = await client.get('/webhooks');
    return response.data.data || response.data || [];
  } catch (error) {
    logger.error('Failed to list Katana webhooks', {
      status: error.response?.status,
      message: error.response?.data?.message || error.message,
    });
    throw error;
  }
}

/**
 * Create a new webhook subscription with Katana
 */
async function createWebhook(url, events) {
  const client = getClient();

  try {
    const response = await client.post('/webhooks', {
      url,
      subscribed_events: events,
    });
    return response.data.data || response.data;
  } catch (error) {
    logger.error('Failed to create Katana webhook', {
      status: error.response?.status,
      message: error.response?.data?.message || error.message,
      data: JSON.stringify(error.response?.data),
    });
    throw error;
  }
}

/**
 * Delete a webhook by ID
 */
async function deleteWebhook(webhookId) {
  const client = getClient();

  try {
    await client.delete(`/webhooks/${webhookId}`);
    logger.info(`Deleted webhook ${webhookId}`);
  } catch (error) {
    logger.error(`Failed to delete webhook ${webhookId}`, {
      status: error.response?.status,
      message: error.response?.data?.message || error.message,
    });
    throw error;
  }
}

/**
 * Register PO webhooks with Katana (one-time setup)
 *
 * 1. Lists existing webhooks to avoid duplicates
 * 2. If our URL is already registered, returns the existing webhook
 * 3. If not, creates a new webhook subscription
 * 4. Katana returns a token — save it as KATANA_WEBHOOK_TOKEN in .env
 */
async function setupPOWebhooks() {
  if (!WEBHOOK_CALLBACK_URL) {
    logger.error('WEBHOOK_CALLBACK_URL is not set in environment variables');
    return null;
  }

  logger.info(`Setting up PO webhooks → ${WEBHOOK_CALLBACK_URL}`);

  const existing = await listWebhooks();
  logger.info(`Found ${existing.length} existing webhook(s): ${JSON.stringify(existing.map((w) => ({ id: w.id, url: w.url })))}`);

  const alreadyRegistered = existing.find((wh) => wh.url === WEBHOOK_CALLBACK_URL);

  if (alreadyRegistered) {
    logger.info(`Webhook already registered (ID: ${alreadyRegistered.id}), skipping creation`);
    return alreadyRegistered;
  }

  logger.info(`Registering new webhook for ${PO_EVENTS.length} PO events...`);
  logger.info(`Payload: ${JSON.stringify({ url: WEBHOOK_CALLBACK_URL, subscribed_events: PO_EVENTS })}`);
  const webhook = await createWebhook(WEBHOOK_CALLBACK_URL, PO_EVENTS);

  logger.info(`Webhook registered successfully (ID: ${webhook.id})`);
  if (webhook.token) {
    logger.info(`IMPORTANT: Save this token as KATANA_WEBHOOK_TOKEN in your .env file`);
    logger.info(`Token: ${webhook.token}`);
  }

  return webhook;
}

/**
 * Verify that an incoming webhook request is from Katana
 *
 * Katana may sign webhooks with an HMAC or include the token.
 * Returns true if valid, false if suspicious.
 */
function verifyWebhookSignature(headers, body) {
  if (!KATANA_WEBHOOK_TOKEN) {
    logger.warn('KATANA_WEBHOOK_TOKEN not set — skipping webhook verification');
    return true;
  }

  const signature = headers['x-katana-signature'] || headers['x-webhook-signature'];

  if (signature) {
    const expectedSignature = crypto
      .createHmac('sha256', KATANA_WEBHOOK_TOKEN)
      .update(typeof body === 'string' ? body : JSON.stringify(body))
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  const token = headers['x-katana-token'] || body?.token;
  if (token) {
    return token === KATANA_WEBHOOK_TOKEN;
  }

  logger.warn('No signature or token found in webhook request — cannot verify');
  return true;
}

module.exports = {
  setupPOWebhooks,
  verifyWebhookSignature,
  listWebhooks,
  deleteWebhook,
};
