require('dotenv').config();
const express = require('express');
const { runSync, getLastSyncResult } = require('./sync');
const { startScheduler, isSyncInProgress, setSyncInProgress, SYNC_SCHEDULE } = require('./cron/scheduler');
const { setupPOWebhooks, verifyWebhookSignature, listWebhooks, deleteWebhook } = require('./services/webhooks');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 3000;

// Parse JSON bodies (need raw body too for webhook verification)
app.use(express.json());

// ─── Health Check ────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'Server is running',
    app: 'Shopify-Katana Integration',
    time: new Date().toISOString(),
    cronSchedule: SYNC_SCHEDULE,
    endpoints: {
      'GET /': 'Health check (this)',
      'GET /status': 'Last sync result',
      'POST /sync': 'Manually trigger full sync',
      'POST /webhooks/katana': 'Katana webhook receiver',
      'POST /webhooks/setup': 'Register Katana webhooks',
      'GET /webhooks/list': 'List all Katana webhooks',
      'DELETE /webhooks/:id': 'Delete a Katana webhook by ID',
    },
  });
});

// ─── Last Sync Status ────────────────────────────────────────
app.get('/status', (req, res) => {
  const lastResult = getLastSyncResult();

  if (!lastResult) {
    return res.json({
      message: 'No sync has been run yet',
      syncInProgress: isSyncInProgress(),
    });
  }

  res.json({
    syncInProgress: isSyncInProgress(),
    lastSync: lastResult,
  });
});

// ─── Manual Full Sync Trigger ────────────────────────────────
app.post('/sync', async (req, res) => {
  if (isSyncInProgress()) {
    return res.status(409).json({
      error: 'Sync already in progress',
      message: 'Please wait for the current sync to finish',
    });
  }

  // Respond immediately, run sync in background
  res.json({
    message: 'Sync started',
    startedAt: new Date().toISOString(),
  });

  setSyncInProgress(true);
  try {
    await runSync();
  } catch (error) {
    logger.error('Manual sync failed', { message: error.message });
  } finally {
    setSyncInProgress(false);
  }
});

// ─── Katana Webhook Receiver ─────────────────────────────────
// Receives PO events from Katana and triggers a re-sync
//
// Katana sends webhook payloads like:
// {
//   "event": "purchase_order.updated",
//   "payload": { ... PO data ... }
// }
//
// Must respond with 2xx within 10 seconds or Katana retries
// (retries at 30s, 2min, 15min)
app.post('/webhooks/katana', async (req, res) => {
  const body = req.body || {};
  const event = body.event || body.type || 'unknown';
  logger.info(`Webhook received: ${event}`, { body });

  // Respond immediately (Katana requires 2xx within 10 seconds)
  res.status(200).json({ received: true });

  // Process in background
  try {
    const isPOEvent = event.startsWith('purchase_order');

    if (isPOEvent) {
      logger.info(`Processing PO webhook event: ${event}`);

      // For PO events, trigger a full re-sync
      // (with <100 products this is fast enough)
      if (!isSyncInProgress()) {
        setSyncInProgress(true);
        try {
          await runSync();
        } finally {
          setSyncInProgress(false);
        }
      } else {
        logger.warn('Sync already in progress, webhook event will be handled by next sync');
      }
    } else {
      logger.info(`Ignoring non-PO webhook event: ${event}`);
    }
  } catch (error) {
    logger.error(`Webhook processing failed for event: ${event}`, {
      message: error.message,
    });
  }
});

// ─── Register Katana Webhooks ────────────────────────────────
// One-time setup endpoint to register PO webhooks with Katana
app.post('/webhooks/setup', async (req, res) => {
  try {
    const result = await setupPOWebhooks();
    if (result) {
      res.json({
        message: 'Webhooks registered successfully',
        webhook: {
          id: result.id,
          url: result.url,
          events: result.subscribed_events,
          token: result.token ? '***' + result.token.slice(-4) : 'N/A',
        },
      });
    } else {
      res.status(400).json({
        error: 'Webhook setup failed or WEBHOOK_CALLBACK_URL not configured',
      });
    }
  } catch (error) {
    res.status(500).json({
      error: 'Failed to register webhooks',
      message: error.message,
    });
  }
});

// ─── List Katana Webhooks ────────────────────────────────────
app.get('/webhooks/list', async (req, res) => {
  try {
    const webhooks = await listWebhooks();
    res.json({
      count: webhooks.length,
      webhooks: webhooks.map((wh) => ({
        id: wh.id,
        url: wh.url,
        enabled: wh.enabled,
        events: wh.subscribed_events,
        created_at: wh.created_at,
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to list webhooks',
      message: error.message,
    });
  }
});

// ─── Delete a Katana Webhook ─────────────────────────────────
app.delete('/webhooks/:id', async (req, res) => {
  try {
    await deleteWebhook(req.params.id);
    res.json({ message: `Webhook ${req.params.id} deleted successfully` });
  } catch (error) {
    res.status(500).json({
      error: `Failed to delete webhook ${req.params.id}`,
      message: error.message,
    });
  }
});

// ─── Start Server ────────────────────────────────────────────
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info('Endpoints: GET /, GET /status, POST /sync, POST /webhooks/katana, POST /webhooks/setup, GET /webhooks/list, DELETE /webhooks/:id');

  // Start the cron scheduler as backup (webhooks are primary)
  startScheduler();
});

