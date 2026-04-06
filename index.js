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

// ─── Health Check (JSON) ─────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Shopify-Katana Integration',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// ─── App Dashboard (rendered inside Shopify admin iframe) ────
app.get('/', (req, res) => {
  const uptimeSeconds = Math.floor(process.uptime());
  const days = Math.floor(uptimeSeconds / 86400);
  const hours = Math.floor((uptimeSeconds % 86400) / 3600);
  const minutes = Math.floor((uptimeSeconds % 3600) / 60);
  const uptimeStr = days > 0
    ? `${days}d ${hours}h ${minutes}m`
    : hours > 0
      ? `${hours}h ${minutes}m`
      : `${minutes}m`;

  const cronSchedule = SYNC_SCHEDULE || '0 */6 * * *';
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  const lastSync = getLastSyncResult();
  const syncInProgress = isSyncInProgress();
  const lastSyncTime = lastSync?.finishedAt
    ? new Date(lastSync.finishedAt).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
    : 'Never';
  const lastSyncDuration = lastSync?.duration || '—';
  const lastSyncMatches = lastSync?.matched ?? '—';
  const lastSyncUpdates = lastSync?.updated ?? '—';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Katana Integration</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');

  *{margin:0;padding:0;box-sizing:border-box}

  :root{
    --bg:#f6f6f1;
    --card:#ffffff;
    --border:#e2e0d8;
    --text:#1a1a18;
    --text-secondary:#6b6960;
    --accent:#4a5a8a;
    --accent-light:#eaecf4;
    --accent-warm:#c97d3c;
    --accent-warm-light:#fef6ee;
    --mono:#5c6b5e;
    --shadow:0 1px 3px rgba(26,26,24,.06),0 1px 2px rgba(26,26,24,.04);
    --shadow-lg:0 4px 12px rgba(26,26,24,.08),0 1px 3px rgba(26,26,24,.06);
    --radius:10px;
  }

  body{
    font-family:'DM Sans',system-ui,-apple-system,sans-serif;
    background:var(--bg);
    color:var(--text);
    line-height:1.55;
    -webkit-font-smoothing:antialiased;
    padding:0;
    min-height:100vh;
  }

  .shell{
    max-width:840px;
    margin:0 auto;
    padding:32px 24px 48px;
  }

  /* ── header ── */
  .header{
    display:flex;
    align-items:center;
    gap:14px;
    margin-bottom:32px;
    padding-bottom:24px;
    border-bottom:1px solid var(--border);
  }
  .header-icon{
    width:42px;height:42px;
    background:var(--accent);
    border-radius:10px;
    display:flex;align-items:center;justify-content:center;
    flex-shrink:0;
  }
  .header-icon svg{width:22px;height:22px;fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;}
  .header h1{font-size:20px;font-weight:700;letter-spacing:-.3px;color:var(--text)}
  .header p{font-size:13px;color:var(--text-secondary);margin-top:2px}

  /* ── cards ── */
  .card{
    background:var(--card);
    border:1px solid var(--border);
    border-radius:var(--radius);
    box-shadow:var(--shadow);
    padding:24px;
    margin-bottom:16px;
  }
  .card-label{
    font-size:11px;
    font-weight:600;
    text-transform:uppercase;
    letter-spacing:.8px;
    color:var(--text-secondary);
    margin-bottom:16px;
    display:flex;align-items:center;gap:6px;
  }
  .card-label svg{width:14px;height:14px;stroke:var(--text-secondary);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

  /* ── status ── */
  .status-row{
    display:flex;
    align-items:center;
    gap:24px;
    flex-wrap:wrap;
  }
  .status-item{display:flex;flex-direction:column;gap:4px}
  .status-item .label{font-size:12px;color:var(--text-secondary);font-weight:500}
  .status-item .value{font-family:'DM Mono',monospace;font-size:14px;font-weight:500;color:var(--text)}
  .status-dot{
    display:inline-flex;align-items:center;gap:7px;
    font-family:'DM Mono',monospace;font-size:14px;font-weight:500;
    color:var(--accent);
  }
  .status-dot::before{
    content:'';display:inline-block;
    width:8px;height:8px;
    background:var(--accent);
    border-radius:50%;
    box-shadow:0 0 0 3px var(--accent-light);
    animation:pulse 2.5s ease-in-out infinite;
  }
  @keyframes pulse{
    0%,100%{box-shadow:0 0 0 3px var(--accent-light)}
    50%{box-shadow:0 0 0 6px rgba(74,90,138,.08)}
  }

  .divider{
    width:100%;height:1px;
    background:var(--border);
    margin:20px 0;
  }

  /* ── steps ── */
  .steps{display:flex;flex-direction:column;gap:0}
  .step{
    display:flex;
    align-items:flex-start;
    gap:16px;
    padding:14px 0;
    position:relative;
  }
  .step+.step{border-top:1px dashed var(--border)}
  .step-num{
    width:28px;height:28px;
    border-radius:50%;
    background:var(--accent-light);
    color:var(--accent);
    font-family:'DM Mono',monospace;
    font-size:12px;font-weight:600;
    display:flex;align-items:center;justify-content:center;
    flex-shrink:0;
    margin-top:1px;
  }
  .step-content h3{font-size:14px;font-weight:600;margin-bottom:3px;color:var(--text)}
  .step-content p{font-size:13px;color:var(--text-secondary);line-height:1.5}

  /* ── config grid ── */
  .config-grid{
    display:grid;
    grid-template-columns:1fr 1fr;
    gap:0;
  }
  .config-item{
    padding:14px 0;
    border-bottom:1px solid var(--border);
  }
  .config-item:nth-child(odd){padding-right:20px;border-right:1px solid var(--border)}
  .config-item:nth-child(even){padding-left:20px}
  .config-item:nth-last-child(-n+2){border-bottom:none}
  .config-item .label{font-size:12px;color:var(--text-secondary);font-weight:500;margin-bottom:4px}
  .config-item .value{font-family:'DM Mono',monospace;font-size:13px;color:var(--text);font-weight:500;word-break:break-all}
  .config-item .value.tag{
    display:inline-flex;gap:6px;flex-wrap:wrap;
  }
  .tag-pill{
    background:var(--accent-warm-light);
    color:var(--accent-warm);
    font-family:'DM Mono',monospace;
    font-size:11px;font-weight:600;
    padding:3px 10px;
    border-radius:20px;
    letter-spacing:.3px;
  }

  /* ── links ── */
  .links{
    display:flex;gap:10px;flex-wrap:wrap;
  }
  .link-btn{
    display:inline-flex;align-items:center;gap:8px;
    padding:10px 18px;
    background:var(--card);
    border:1px solid var(--border);
    border-radius:8px;
    font-family:'DM Sans',sans-serif;
    font-size:13px;font-weight:600;
    color:var(--text);
    text-decoration:none;
    transition:all .15s ease;
    box-shadow:var(--shadow);
    cursor:pointer;
  }
  .link-btn:hover{
    border-color:var(--accent);
    color:var(--accent);
    box-shadow:var(--shadow-lg);
    transform:translateY(-1px);
  }
  .link-btn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

  /* ── sync badge ── */
  .sync-badge{
    display:inline-flex;align-items:center;gap:5px;
    font-family:'DM Mono',monospace;font-size:12px;font-weight:600;
    padding:3px 10px;border-radius:20px;
  }
  .sync-badge.idle{background:#e8f3ed;color:#2a6b4a}
  .sync-badge.running{background:var(--accent-warm-light);color:var(--accent-warm);animation:pulse-warm 2s ease-in-out infinite}
  @keyframes pulse-warm{
    0%,100%{opacity:1}
    50%{opacity:.6}
  }

  /* ── footer ── */
  .footer{
    text-align:center;
    padding-top:32px;
    font-size:12px;
    color:var(--text-secondary);
    letter-spacing:.2px;
  }
  .footer span{font-weight:600;color:var(--text)}

  /* ── two-column layout ── */
  .row-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  @media(max-width:640px){
    .row-2{grid-template-columns:1fr}
    .config-grid{grid-template-columns:1fr}
    .config-item:nth-child(odd){padding-right:0;border-right:none}
    .config-item:nth-child(even){padding-left:0}
  }
</style>
</head>
<body>
<div class="shell">

  <div class="header">
    <div class="header-icon">
      <svg viewBox="0 0 24 24"><path d="M4 4h16v16H4z"/><path d="M4 9h16"/><path d="M9 4v16"/></svg>
    </div>
    <div>
      <h1>Katana Integration</h1>
      <p>Automated PO arrival date sync for Turn Offroad</p>
    </div>
  </div>

  <div class="row-2">
    <div class="card">
      <div class="card-label">
        <svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        System Status
      </div>
      <div class="status-row">
        <div class="status-item">
          <span class="label">Server</span>
          <span class="status-dot">Online</span>
        </div>
        <div class="status-item">
          <span class="label">Uptime</span>
          <span class="value">${uptimeStr}</span>
        </div>
        <div class="status-item">
          <span class="label">Sync</span>
          <span class="sync-badge ${syncInProgress ? 'running' : 'idle'}">${syncInProgress ? 'Running' : 'Idle'}</span>
        </div>
      </div>
      <div class="divider"></div>
      <div class="status-item">
        <span class="label">Last checked</span>
        <span class="value" style="font-size:12px;color:var(--text-secondary)">${timestamp}</span>
      </div>
    </div>

    <div class="card">
      <div class="card-label">
        <svg viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        Quick Links
      </div>
      <div class="links" style="flex-direction:column">
        <a class="link-btn" href="https://katanamrp.com" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          Katana Dashboard
        </a>
        <a class="link-btn" href="/health" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
          Health Check Endpoint
        </a>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-label">
      <svg viewBox="0 0 24 24"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
      Last Sync
    </div>
    <div class="status-row">
      <div class="status-item">
        <span class="label">Completed</span>
        <span class="value" style="font-size:12px">${lastSyncTime}</span>
      </div>
      <div class="status-item">
        <span class="label">Duration</span>
        <span class="value">${lastSyncDuration}</span>
      </div>
      <div class="status-item">
        <span class="label">SKUs Matched</span>
        <span class="value">${lastSyncMatches}</span>
      </div>
      <div class="status-item">
        <span class="label">Metafields Updated</span>
        <span class="value">${lastSyncUpdates}</span>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-label">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      How It Works
    </div>
    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-content">
          <h3>Purchase Orders Fetched</h3>
          <p>Pulls all open Purchase Orders from <strong>Katana MRP</strong> and builds an arrival date map by SKU.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-content">
          <h3>Products Matched</h3>
          <p>Fetches all Shopify product variants and matches them to Katana POs by <strong>SKU</strong>.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-content">
          <h3>Metafields Updated</h3>
          <p>Sets <strong>arrival date</strong>, <strong>expected quantity</strong>, and <strong>PO number</strong> as variant metafields on Shopify.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-content">
          <h3>Storefront Displays</h3>
          <p>Your theme reads the metafields to show customers messages like <em>"85 units arriving Feb 28"</em>.</p>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <div class="card-label">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      Configuration
    </div>
    <div class="config-grid">
      <div class="config-item">
        <div class="label">Webhook endpoint</div>
        <div class="value">/webhooks/katana</div>
      </div>
      <div class="config-item">
        <div class="label">Cron schedule</div>
        <div class="value">${cronSchedule}</div>
      </div>
      <div class="config-item">
        <div class="label">Metafields written</div>
        <div class="value tag">
          <span class="tag-pill">arrival_date</span>
          <span class="tag-pill">quantity</span>
          <span class="tag-pill">po_id</span>
        </div>
      </div>
      <div class="config-item">
        <div class="label">Sync trigger</div>
        <div class="value">Webhooks + Cron</div>
      </div>
    </div>
  </div>

  <div class="footer">Built by <a href="https://www.cloveode.com/" target="_blank" rel="noopener" style="color:var(--accent);font-weight:600;text-decoration:none">CloveOde</a></div>

</div>
</body>
</html>`;

  res.type('html').send(html);
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

