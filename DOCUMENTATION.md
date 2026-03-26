# Shopify-Katana Integration — Complete Documentation

> A Node.js backend that syncs Purchase Order arrival dates from **Katana MRP** to **Shopify variant metafields**.
> This enables the Shopify storefront to show per-variant messages like **"85 units arriving Feb 28"**.

---

## Table of Contents

1. [What Does This App Do?](#1-what-does-this-app-do)
2. [How the Whole Thing Works (Big Picture)](#2-how-the-whole-thing-works-big-picture)
3. [Project File Structure](#3-project-file-structure)
4. [File-by-File Breakdown](#4-file-by-file-breakdown)
   - [index.js — The Server](#indexjs--the-server)
   - [sync.js — The Brain](#syncjs--the-brain)
   - [services/katana.js — Katana API Service](#serviceskatanajs--katana-api-service)
   - [services/shopify.js — Shopify API Service](#servicesshopifyjs--shopify-api-service)
   - [services/webhooks.js — Webhook Management](#serviceswebhooksjs--webhook-management)
   - [cron/scheduler.js — Automatic Timer](#cronschedulerjs--automatic-timer)
   - [utils/logger.js — Logging](#utilsloggerjs--logging)
5. [Three Ways the Sync Runs](#5-three-ways-the-sync-runs)
   - [Manual Sync](#a-manual-sync-you-trigger-it)
   - [Automatic Cron Sync](#b-automatic-cron-sync-timer-triggers-it)
   - [Webhook Sync](#c-webhook-sync-katana-triggers-it)
6. [Step-by-Step: What Happens During a Sync](#6-step-by-step-what-happens-during-a-sync)
7. [The Matching Logic Explained](#7-the-matching-logic-explained)
8. [API Endpoints Reference](#8-api-endpoints-reference)
9. [Environment Variables (.env)](#9-environment-variables-env)
10. [Node.js Concepts Used (For Beginners)](#10-nodejs-concepts-used-for-beginners)
11. [How to Debug](#11-how-to-debug)
12. [Deployment Guide](#12-deployment-guide)
13. [Common Errors & Fixes](#13-common-errors--fixes)
14. [Testing Checklist](#14-testing-checklist)

---

## 1. What Does This App Do?

**Simple version:** When someone creates a Purchase Order (PO) in Katana (e.g., "85 units of Widget-A arriving March 15"), this app automatically reads that information and writes it to Shopify so the storefront can display it.

**What it writes to Shopify (per variant):**

| Metafield | Example | Purpose |
|-----------|---------|---------|
| `custom.next_expected_arrival_date` | `2026-03-15` | When the stock will arrive |
| `custom.next_expected_quantity` | `85` | How many units are coming |
| `custom.next_expected_po_id` | `PO-42` | Which Purchase Order it's from |

**Note:** When a variant has no open POs, these metafields are **deleted** (not set to empty/zero) because Shopify doesn't allow blank metafield values.

---

## 2. How the Whole Thing Works (Big Picture)

```
┌──────────────────────────────────────────────────────────────┐
│                        KATANA MRP                            │
│                                                              │
│  Variants ──── (each has a SKU like "WIDGET-A")              │
│  Purchase Orders ──── (each has an expected_arrival_date)    │
│  PO Rows ──── (each links a variant to a PO with qty)       │
│                                                              │
│  Webhooks: When a PO changes, Katana sends a notification   │
│            to our server automatically                       │
└──────────────┬───────────────────────────────────────────────┘
               │
               │  API calls (our server fetches data)
               │  + Webhooks (Katana pushes notifications)
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│               OUR SERVER (Digital Ocean)                      │
│               https://turnoffroad.duckdns.org                │
│                                                              │
│  1. Fetches variants from Katana (to get SKUs)               │
│  2. Fetches Purchase Orders (to get arrival dates)           │
│  3. Fetches PO Rows (to get qty per variant per PO)          │
│  4. Builds a map: { "WIDGET-A" → arrives March 15, qty 85 } │
│  5. Fetches products from Shopify                            │
│  6. Matches each variant by SKU and writes variant metafields│
│     (or deletes metafields if no open POs for that variant)  │
│                                                              │
│  Triggers: Manual (POST /sync) | Cron (every 6 hrs) |       │
│            Webhook (Katana sends event)                      │
└──────────────┬───────────────────────────────────────────────┘
               │
               │  Shopify Admin API calls
               │
               ▼
┌──────────────────────────────────────────────────────────────┐
│                       SHOPIFY STORE                           │
│                                                              │
│  Product "Widget A"                                          │
│    └── Variant "Default" (SKU: WIDGET-A)                     │
│         └── Metafields:                                      │
│              custom.next_expected_arrival_date = "2026-03-15" │
│              custom.next_expected_quantity = 85               │
│              custom.next_expected_po_id = "PO-42"            │
│                                                              │
│  Storefront can now show per-variant: "85 units arriving     │
│  March 15"                                                   │
└──────────────────────────────────────────────────────────────┘
```

---

## 3. Project File Structure

```
shopify-katana-integration/
│
├── index.js                 # Entry point — starts the Express server
│                            #   Defines all URL endpoints (/sync, /status, etc.)
│                            #   Starts the cron scheduler on boot
│
├── sync.js                  # The "brain" — orchestrates the entire sync process
│                            #   Calls Katana service, then Shopify service
│                            #   Matches each variant's SKU and updates/deletes metafields
│
├── services/
│   ├── katana.js            # Talks to Katana API
│   │                        #   Fetches variants, POs, PO rows
│   │                        #   Builds the arrival date map
│   │
│   ├── shopify.js           # Talks to Shopify API
│   │                        #   Fetches products
│   │                        #   Creates/updates/deletes variant metafields
│   │
│   └── webhooks.js          # Manages Katana webhook subscriptions
│                            #   Registers webhooks, verifies incoming requests
│
├── cron/
│   └── scheduler.js         # Timer that runs sync automatically
│                            #   Uses node-cron (like a built-in alarm clock)
│
├── utils/
│   └── logger.js            # Logging utility
│                            #   Writes to console AND to daily log files
│
├── logs/                    # Auto-created folder for log files
│   └── sync-2026-02-14.log  # Example: today's log file
│
├── .env                     # Your secret API keys (NEVER commit this)
├── .env.example             # Template showing what .env should look like
├── .gitignore               # Tells git to ignore node_modules, .env, logs
├── package.json             # Lists dependencies and project info
└── package-lock.json        # Exact dependency versions (auto-generated)
```

---

## 4. File-by-File Breakdown

### `index.js` — The Server

**What it is:** The entry point. When you run `node index.js`, this file runs first.

**What it does:**
1. Loads environment variables from `.env` (line 1: `require('dotenv').config()`)
2. Creates an Express web server (line 2-3)
3. Defines 5 URL endpoints (routes) that respond to HTTP requests
4. Starts the cron scheduler when the server boots up

**Endpoints defined here:**

| Line(s) | Endpoint | What it does |
|---------|----------|--------------|
| 15-29 | `GET /` | Returns "Server is running" + list of all endpoints |
| 32-46 | `GET /status` | Returns the result of the last sync (or "no sync yet") |
| 49-71 | `POST /sync` | Starts a full sync manually (responds immediately, runs in background) |
| 84-118 | `POST /webhooks/katana` | Receives webhook events from Katana (responds in <10 sec, processes in background) |
| 122-146 | `POST /webhooks/setup` | One-time: registers our URL with Katana to receive PO events |

**Key functions it imports:**

| Import | From | Purpose |
|--------|------|---------|
| `runSync` | sync.js | The main sync function |
| `getLastSyncResult` | sync.js | Get results of last sync for /status |
| `startScheduler` | cron/scheduler.js | Start the automatic timer |
| `isSyncInProgress` | cron/scheduler.js | Check if sync is already running (prevent double-runs) |
| `setSyncInProgress` | cron/scheduler.js | Set the sync-in-progress flag (used by manual trigger + webhooks) |
| `SYNC_SCHEDULE` | cron/scheduler.js | The cron schedule string (shown in health check response) |
| `setupPOWebhooks` | services/webhooks.js | Register webhooks with Katana |
| `verifyWebhookSignature` | services/webhooks.js | Verify incoming webhook requests are from Katana |

---

### `sync.js` — The Brain

**What it is:** The main orchestrator. It doesn't talk to any API directly — it calls the services to do that.

**Key functions:**

#### `runSync()` (line 29)
This is the main function. Everything starts here. Here's exactly what happens:

```
Step 1: Call katana.buildArrivalDateMap()
        → This returns a map like:
          {
            "WIDGET-A": { nextArrivalDate: "2026-03-15", expectedQty: 85, poNumber: "PO-42" },
            "GADGET-B": { nextArrivalDate: "2026-04-01", expectedQty: 200, poNumber: "PO-43" }
          }

Step 2: Call shopify.fetchAllProducts()
        → This returns all Shopify products with their variants/SKUs

Step 3: For EACH Shopify variant (not product):
        → Get the variant's SKU
        → Skip if no SKU
        → Check if that SKU exists in the arrival date map
        → If matched: call shopify.updateVariantArrivalMetafields(variant.id, data)
          to write arrival metafields on THAT variant
        → If no match: call shopify.clearVariantArrivalMetafields(variant.id)
          to DELETE any stale arrival metafields from that variant
        → Wait 550ms between variants (Shopify rate limit)

Step 4: Log a summary of what happened
```

**Why per-variant instead of per-product?** A product like "T-Shirt" may have sizes S, M, L. Each size is a variant with its own SKU. Size S may have stock arriving March 15 while size L arrives April 1. By writing metafields per-variant, the storefront can show accurate per-size arrival dates.

#### `getLastSyncResult()` (line 13)
Returns the last sync result object. Used by the `/status` endpoint.

---

### `services/katana.js` — Katana API Service

**What it is:** All communication with the Katana MRP API happens here.

**Authentication:** Every request includes `Authorization: Bearer <your_api_key>` header.

**Key functions:**

#### `getClient()` (line 11)
Creates an HTTP client (using axios) pre-configured with:
- Base URL: `https://api.katanamrp.com/v1`
- Auth header: `Bearer <KATANA_API_KEY>`

Think of it like: "create a messenger that already knows the address and password."

#### `fetchAllPages(endpoint)` (line 29)
Handles **pagination**. APIs don't return all data at once — they return page 1, then you ask for page 2, etc. This function keeps fetching until there are no more pages.

Katana uses the `x-pagination` response header. This header contains a JSON object with a `last_page` field. The function increments the `page` query parameter and stops when `last_page` is `true`.

```
Page 1: GET /variants?page=1 → returns items + x-pagination header { last_page: false }
Page 2: GET /variants?page=2 → returns items + x-pagination header { last_page: true }
Done: all items collected
```

#### `fetchAllVariants()` (line 76)
Calls `GET /v1/variants` to get all Katana variants.
Each variant has an `id` and a `sku`. The SKU is how we match to Shopify.

#### `fetchAllPurchaseOrders()` (line 94)
Calls `GET /v1/purchase_orders` to get all POs.
Each PO has: `id`, `po_no`, `status`, `expected_arrival_date`.
We only care about POs where status is NOT "RECEIVED" (still open).

#### `fetchAllPurchaseOrderRows()` (line 108)
Calls `GET /v1/purchase_order_rows` to get all PO line items.
Each row links a `variant_id` to a `purchase_order_id` with `quantity` and `received_quantity`.
We calculate remaining: `quantity - received_quantity`.

#### `buildArrivalDateMap()` (line 137) — THE BIG ONE
This is the most important function. Here's the step-by-step:

```
Step 1: Fetch 3 things in parallel (faster than one-by-one):
        - All variants (to map variant_id → SKU)
        - All purchase orders (to get expected_arrival_date per PO)
        - All PO rows (to link variants to POs)

Step 2: Build a SKU lookup from variants
        { 12345: "WIDGET-A", 12346: "GADGET-B", ... }

Step 3: Filter POs — keep only open ones (NOT status "RECEIVED")
        { 100: { poNumber: "PO-42", expectedArrivalDate: "2026-03-15" }, ... }

Step 4: Loop through PO rows:
        For each row:
        ├── Is the parent PO still open? (check openPOs map)
        ├── Does the parent PO have an arrival date?
        ├── Does this variant have a SKU? (check variantSkuLookup)
        ├── Is there remaining quantity? (ordered - received > 0)
        └── If ALL yes: add to arrivals list for this SKU

Step 5: For each SKU with arrivals, pick the EARLIEST arrival date
        If SKU "WIDGET-A" has arrivals on March 15 and April 1,
        we pick March 15.

Returns: { "WIDGET-A": { nextArrivalDate: "2026-03-15", expectedQty: 85, poNumber: "PO-42" } }
```

---

### `services/shopify.js` — Shopify API Service

**What it is:** All communication with the Shopify Admin API happens here.

**Authentication:** Every request includes `X-Shopify-Access-Token: <token>` header.

**Key functions:**

#### `getClient()` (line 12)
Creates an HTTP client for Shopify Admin API:
- Base URL: `https://your-store.myshopify.com/admin/api/2024-10`
- Auth header: `X-Shopify-Access-Token: <SHOPIFY_ACCESS_TOKEN>`

#### `fetchAllProducts()` (line 32)
Calls `GET /products.json?limit=250` to get all Shopify products.
Handles pagination using the `Link` header (Shopify's way of saying "here's the next page URL").

Each product has:
```json
{
  "id": 123456789,
  "title": "Widget A",
  "variants": [
    { "id": 111, "sku": "WIDGET-A", "price": "29.99" },
    { "id": 222, "sku": "WIDGET-A-LG", "price": "34.99" }
  ]
}
```

#### `setVariantMetafields(variantId, metafields)` (line 76)
Takes a variant ID and an array of metafield objects, writes them one by one.

If a metafield already exists (HTTP 422 error), it calls `findAndUpdateVariantMetafield()` to find the existing one and update it instead.

#### `findAndUpdateVariantMetafield(variantId, mf)` (line 117)
When creating a variant metafield fails because it already exists:
1. Lists existing metafields for that variant
2. Finds the one matching our namespace + key
3. Updates it with the new value via PUT

#### `updateVariantArrivalMetafields(variantId, arrivalData)` (line 166)
The main function called by sync.js. Takes arrival data and writes 3 metafields **on the variant**:

```
custom.next_expected_arrival_date  →  "2026-03-15"     (date type)
custom.next_expected_quantity      →  85                (integer type)
custom.next_expected_po_id         →  "PO-42"           (text type)
```

#### `clearVariantArrivalMetafields(variantId)` (line 199)
**Deletes** the arrival metafields from a variant when there are no open POs for it. Shopify does not allow setting metafields to blank/empty values, so we delete them entirely.

Flow:
1. Fetches existing metafields in the `custom` namespace for the variant
2. Finds any with keys matching our arrival fields
3. Deletes each one via `DELETE /variants/{id}/metafields/{mf_id}.json`

#### `formatDateForShopify(isoDateString)` (line 224)
Converts `"2026-03-15T00:00:00.000Z"` → `"2026-03-15"` (Shopify's date format).

---

### `services/webhooks.js` — Webhook Management

**What it is:** Manages webhook subscriptions with Katana. Instead of polling Katana every few hours, Katana can **push** updates to us instantly.

**How webhooks work (analogy):**
- **Without webhooks (polling):** You check your mailbox every hour. "Any letters? No. Any letters? No. Any letters? Yes!"
- **With webhooks:** The postman rings your doorbell when a letter arrives. Instant.

**Current webhook setup:**
- **Callback URL:** `https://turnoffroad.duckdns.org/webhooks/katana`
- **Status:** Registered and active (token saved in `.env`)
- **SSL:** Required — Katana sends webhooks over HTTPS (hence the DuckDNS domain with SSL cert)

**Events we subscribe to (defined in `PO_WEBHOOK_EVENTS` array, line 16):**
```
purchase_order.created              — New PO created
purchase_order.updated              — PO details changed (arrival date!)
purchase_order.deleted              — PO deleted
purchase_order.partially_received   — Some items received
purchase_order.received             — All items received
purchase_order_row.created          — New item added to PO
purchase_order_row.updated          — Item qty changed
purchase_order_row.deleted          — Item removed from PO
purchase_order_row.received         — Item marked as received
```

**End-to-end webhook flow:**
```
1. Someone edits a PO in Katana (e.g., changes arrival date)
2. Katana sees this matches a subscribed event (purchase_order.updated)
3. Katana sends POST to https://turnoffroad.duckdns.org/webhooks/katana
   Body: { "event": "purchase_order.updated", "payload": { ... } }
4. Our server (index.js line 84) receives it
5. Responds 200 immediately (Katana requires 2xx within 10 seconds)
6. In background: checks if it's a PO event → triggers runSync()
7. runSync() re-fetches all data from Katana and updates Shopify metafields
```

**Key functions:**

#### `listWebhooks()` (line 46)
Calls `GET /v1/webhooks` to list all existing webhook subscriptions in Katana. Used by `setupPOWebhooks()` to check if our URL is already registered (avoids duplicates).

#### `createWebhook(url, events)` (line 68)
Sends `POST /v1/webhooks` with our callback URL and event list. Katana returns the created webhook object including a `token` for verification.

#### `deleteWebhook(webhookId)` (line 97)
Calls `DELETE /v1/webhooks/{id}` to remove a webhook subscription. Useful if you need to re-register with different events.

#### `setupPOWebhooks()` (line 118)
The main setup function (already run, one-time):
1. Checks if `WEBHOOK_CALLBACK_URL` is set in `.env`
2. Calls `listWebhooks()` to check if our URL is already registered
3. If already registered: returns the existing webhook (no duplicate)
4. If not registered: calls `createWebhook()` to register a new one
5. Logs the webhook `token` — must be saved as `KATANA_WEBHOOK_TOKEN` in `.env`

#### `verifyWebhookSignature(headers, body)` (line 165)
Checks that an incoming webhook request is actually from Katana (not someone pretending to be). Compares the `token` field in the webhook payload against the `KATANA_WEBHOOK_TOKEN` env var. If no token is configured, it allows all requests through (dev mode).

---

### `cron/scheduler.js` — Automatic Timer

**What it is:** Sets up an automatic timer to run the sync on a schedule using `node-cron`.

**Cron schedule format:** `minute hour day month weekday`
```
0 */6 * * *     = At minute 0, every 6th hour    = Every 6 hours
0 * * * *       = At minute 0, every hour         = Every hour
*/30 * * * *    = Every 30th minute               = Every 30 minutes
0 6 * * *       = At minute 0, at hour 6          = Every day at 6 AM
```

**Key functions:**

#### `startScheduler()` (line 15)
Called once when the server starts. Sets up the cron job.
When the timer fires, it:
1. Checks if a sync is already running (prevents overlapping syncs)
2. If not, calls `runSync()` from sync.js
3. Marks sync as done when finished

#### `isSyncInProgress()` / `setSyncInProgress()` (lines 57, 64)
A simple flag (true/false) to prevent two syncs from running at the same time. Shared between manual trigger, cron, and webhooks.

---

### `utils/logger.js` — Logging

**What it is:** A simple logging utility. Every log message goes to two places:
1. **Console** (you see it in `pm2 logs`) — for real-time monitoring
2. **Log file** (in `logs/sync-YYYY-MM-DD.log`) — for history

**Log levels:** `info`, `warn`, `error`, `success`

**Console output example:**
```
[2026-02-14T10:30:00.000Z] [INFO] Fetching all variants from Katana...
[2026-02-14T10:30:01.500Z] [SUCCESS] Updated "Widget A" → 85 units arriving 2026-03-15 (PO-42)
[2026-02-14T10:30:05.000Z] [ERROR] Failed to update "Gadget B": 429 Too Many Requests
```

**File output:** JSON format (one JSON object per line), easy to parse:
```json
{"timestamp":"2026-02-14T10:30:00.000Z","level":"info","message":"Fetching all variants from Katana..."}
```

---

## 5. Three Ways the Sync Runs

### A. Manual Sync (You Trigger It)

**When:** You send a POST request to `/sync` (e.g., from browser, Postman, or command line).

**Flow:**
```
You ─── POST /sync ───→ index.js (line 49)
                              │
                              ├── Checks: is a sync already running?
                              ├── If yes: returns 409 "already in progress"
                              ├── If no: responds "Sync started" immediately
                              │
                              └── In background:
                                  setSyncInProgress(true)
                                  └── runSync() ← calls sync.js
                                      ├── katana.buildArrivalDateMap()
                                      ├── shopify.fetchAllProducts()
                                      ├── For each variant: match SKU
                                      │   ├── Matched → update variant metafields
                                      │   └── Not matched → delete variant metafields
                                      └── Log summary
                                  setSyncInProgress(false)
```

**How to trigger:**
```bash
# From your terminal:
curl -X POST https://turnoffroad.duckdns.org/sync

# Then check result:
curl https://turnoffroad.duckdns.org/status
```

---

### B. Automatic Cron Sync (Timer Triggers It)

**When:** Every 6 hours (or whatever `SYNC_CRON_SCHEDULE` is set to in `.env`).

**Flow:**
```
Server starts ──→ index.js (line 154) calls startScheduler()
                                            │
                                            └── cron/scheduler.js sets up timer
                                                    │
                                                    │  (waits until scheduled time)
                                                    │
                                                    └── Timer fires! (e.g., at 6:00 AM)
                                                        ├── Checks: sync already running?
                                                        ├── If yes: skip
                                                        └── If no: runSync()
                                                            └── (same as manual)
```

**You don't need to do anything** — it runs automatically as long as the server is running.

---

### C. Webhook Sync (Katana Triggers It)

**When:** Someone creates, updates, or receives a Purchase Order in Katana.

**Flow:**
```
Someone edits a PO in Katana UI (or via API)
        │
        └── Katana sends HTTP POST to our server
            POST https://turnoffroad.duckdns.org/webhooks/katana
            Body: { "event": "purchase_order.updated", "payload": { ... } }
                │
                └── index.js (line 84) receives it
                    │
                    ├── Responds 200 immediately (Katana needs this within 10 seconds)
                    │
                    └── In background:
                        ├── Is this a purchase_order* event? Yes!
                        ├── Is sync already running? No!
                        └── runSync()
                            └── (same full sync as manual)
```

**Setup (already completed):**
Webhooks are registered at `https://turnoffroad.duckdns.org/webhooks/katana`. The webhook token is saved in `.env` as `KATANA_WEBHOOK_TOKEN`. If you ever need to re-register:
```bash
curl -X POST https://turnoffroad.duckdns.org/webhooks/setup
```

**Katana retry policy:** If our server doesn't respond 2xx within 10 seconds, Katana retries at: 30 seconds, 2 minutes, 15 minutes.

---

## 6. Step-by-Step: What Happens During a Sync

Here's the complete journey, line by line:

```
1. runSync() is called (sync.js line 29)

2. KATANA PHASE:
   ├── buildArrivalDateMap() called (katana.js line 137)
   │
   ├── 3 API calls fire IN PARALLEL (Promise.all on line 141):
   │   ├── GET https://api.katanamrp.com/v1/variants
   │   │   → Returns: [{ id: 100, sku: "WIDGET-A" }, { id: 101, sku: "GADGET-B" }, ...]
   │   │
   │   ├── GET https://api.katanamrp.com/v1/purchase_orders
   │   │   → Returns: [{ id: 1, po_no: "PO-42", status: "NOT_RECEIVED",
   │   │                   expected_arrival_date: "2026-03-15" }, ...]
   │   │
   │   └── GET https://api.katanamrp.com/v1/purchase_order_rows
   │       → Returns: [{ purchase_order_id: 1, variant_id: 100,
   │                      quantity: 100, received_quantity: 15 }, ...]
   │
   ├── Build variant lookup: { 100: "WIDGET-A", 101: "GADGET-B" }
   │
   ├── Filter POs: skip any with status "RECEIVED"
   │   → { 1: { poNumber: "PO-42", expectedArrivalDate: "2026-03-15" } }
   │
   ├── Process PO rows:
   │   Row: variant_id=100, purchase_order_id=1, qty=100, received=15
   │   → PO 1 is open? YES
   │   → PO 1 has arrival date? YES (March 15)
   │   → Variant 100 has SKU? YES ("WIDGET-A")
   │   → Remaining qty: 100 - 15 = 85 > 0? YES
   │   → Add: "WIDGET-A" → arrives March 15, qty 85, PO-42
   │
   └── Final map: { "WIDGET-A": { nextArrivalDate: "2026-03-15",
                                    expectedQty: 85, poNumber: "PO-42" } }

3. SHOPIFY PHASE:
   ├── fetchAllProducts() called (shopify.js line 32)
   │   GET https://your-store.myshopify.com/admin/api/2024-10/products.json
   │   → Returns: [{ id: 9876, title: "Widget A",
   │                  variants: [{ id: 111, sku: "WIDGET-A" }] }, ...]
   │
   ├── For each product → for each variant:
   │
   │   ├── Variant "Default" (ID: 111, SKU: "WIDGET-A")
   │   │   ├── Look up SKU in arrival map → FOUND!
   │   │   │   → { nextArrivalDate: "2026-03-15", expectedQty: 85, poNumber: "PO-42" }
   │   │   │
   │   │   ├── updateVariantArrivalMetafields(111, data) called (shopify.js line 166)
   │   │   │   ├── POST /variants/111/metafields.json
   │   │   │   │   → { namespace: "custom", key: "next_expected_arrival_date",
   │   │   │   │       value: "2026-03-15", type: "date" }
   │   │   │   │
   │   │   │   ├── POST /variants/111/metafields.json
   │   │   │   │   → { namespace: "custom", key: "next_expected_quantity",
   │   │   │   │       value: "85", type: "number_integer" }
   │   │   │   │
   │   │   │   └── POST /variants/111/metafields.json
   │   │   │       → { namespace: "custom", key: "next_expected_po_id",
   │   │   │           value: "PO-42", type: "single_line_text_field" }
   │   │   │
   │   │   └── Log: SUCCESS "Updated variant (ID: 111, SKU: WIDGET-A) → Arrival: 2026-03-15, Qty: 85, PO: PO-42"
   │   │
   │   ├── Wait 550ms (rate limiting)
   │   │
   │   └── Variant "Other" (ID: 222, SKU: "WIDGET-B") — no match in arrival map
   │       ├── clearVariantArrivalMetafields(222) called (shopify.js line 199)
   │       │   → Fetches existing metafields, DELETES any arrival-related ones
   │       └── Log: "Cleared arrival metafields for variant (ID: 222, SKU: WIDGET-B) — no inbound POs"
   │
   └── Next product... (repeat)

4. DONE:
   └── Log summary: { matched: 1, updated: 1, cleared: 1, skipped: 0, failed: 0, duration: "15.3s" }
```

---

## 7. The Matching Logic Explained

The **SKU** (Stock Keeping Unit) is the glue between Katana and Shopify.

```
IN KATANA:
  Variant ID 100 has SKU "WIDGET-A"
  PO row says: variant_id=100, ordered=100, received=15
  PO says: expected_arrival_date = "2026-03-15"

IN SHOPIFY:
  Product "Widget A" has a variant with SKU "WIDGET-A"

MATCH: Both have SKU "WIDGET-A" → They're the same item!

So we write to the Shopify VARIANT (not the product):
  "85 units arriving March 15, PO-42"
```

**What if a Shopify product has multiple variants (sizes/colors)?**
Each variant is processed individually. Size S, Size M, and Size L each get their own arrival metafields based on their own SKU match. This means each variant can show different arrival dates.

**What if a SKU has multiple open POs?**
We pick the one with the **earliest** `expected_arrival_date`. We also track `totalInboundQty` across all POs and `openPOCount`.

**What if a variant has no open POs?**
We **delete** any existing arrival metafields from that variant, so stale data doesn't remain. Shopify doesn't allow blank metafield values, so deletion is the correct approach.

---

## 8. API Endpoints Reference

### `GET /` — Health Check
```bash
curl https://turnoffroad.duckdns.org/
```
Response:
```json
{
  "status": "Server is running",
  "app": "Shopify-Katana Integration",
  "time": "2026-02-14T10:00:00.000Z",
  "cronSchedule": "0 */6 * * *",
  "endpoints": { ... }
}
```

### `GET /status` — Last Sync Result
```bash
curl https://turnoffroad.duckdns.org/status
```
Response (after a sync has run):
```json
{
  "syncInProgress": false,
  "lastSync": {
    "startedAt": "2026-02-14T10:00:00.000Z",
    "finishedAt": "2026-02-14T10:00:12.300Z",
    "duration": "12.3s",
    "katanaSkus": 5,
    "shopifyProducts": 46,
    "shopifyVariants": 120,
    "matched": 5,
    "updated": 5,
    "cleared": 115,
    "skipped": 0,
    "failed": 0,
    "errors": []
  }
}
```

### `POST /sync` — Manual Trigger
```bash
curl -X POST https://turnoffroad.duckdns.org/sync
```
Response (immediate):
```json
{
  "message": "Sync started",
  "startedAt": "2026-02-14T10:00:00.000Z"
}
```
Then check `/status` to see the result once it finishes.

### `POST /webhooks/setup` — Register Katana Webhooks (One-Time, Already Done)
Webhooks are already registered. If you ever need to re-register:
```bash
curl -X POST https://turnoffroad.duckdns.org/webhooks/setup
```
Response:
```json
{
  "message": "Webhooks registered successfully",
  "webhook": {
    "id": 123,
    "url": "https://turnoffroad.duckdns.org/webhooks/katana",
    "events": ["purchase_order.created", "purchase_order.updated", ...],
    "token": "***a1b2"
  }
}
```
**IMPORTANT:** Save the full token (from server logs) as `KATANA_WEBHOOK_TOKEN` in `.env`, then restart PM2.

### `POST /webhooks/katana` — Webhook Receiver (Called by Katana)
Not something you call manually. Katana sends POST requests here automatically.

---

## 9. Environment Variables (.env)

Create a `.env` file from `.env.example`:

```bash
cp .env.example .env
nano .env    # or edit in VS Code
```

| Variable | What it is | Example |
|----------|-----------|---------|
| `PORT` | Port the server runs on | `3000` |
| `SHOPIFY_STORE_URL` | Your Shopify store domain | `my-store.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | Shopify Admin API access token | `shpca_abc123...` (new Dev Dashboard apps use `shpca_` prefix) |
| `SHOPIFY_API_VERSION` | Shopify API version | `2024-10` |
| `KATANA_API_KEY` | Katana API key (from Settings > API) | `kat_xyz789...` |
| `KATANA_API_BASE_URL` | Katana API base URL | `https://api.katanamrp.com/v1` |
| `WEBHOOK_CALLBACK_URL` | Public URL for webhook receiver | `https://turnoffroad.duckdns.org/webhooks/katana` |
| `KATANA_WEBHOOK_TOKEN` | Token from webhook setup (for verification) | `73f82127d57a2cea` |
| `SYNC_CRON_SCHEDULE` | How often to auto-sync | `0 */6 * * *` |

---

## 10. Node.js Concepts Used (For Beginners)

### `require()` — Importing Files
```javascript
const express = require('express');        // Import npm package
const katana = require('./services/katana'); // Import our own file
```
Think of it as: "bring in the code from that file so I can use its functions."

### `module.exports` — Exporting Functions
```javascript
// In katana.js:
module.exports = { fetchAllVariants, fetchAllPurchaseOrders, fetchAllPurchaseOrderRows, buildArrivalDateMap };

// In sync.js:
const katana = require('./services/katana');
katana.buildArrivalDateMap();  // Now we can call it
```
Think of it as: "these are the functions I'm making available to other files."

### `async / await` — Waiting for API Calls
```javascript
async function runSync() {
  const data = await katana.buildArrivalDateMap();
  // ↑ "wait" for the API calls to finish, THEN continue
}
```
API calls take time (network). `await` says "pause here until the data comes back."

### `Promise.all()` — Run Multiple Things at the Same Time
```javascript
const [variants, purchaseOrders, poRows] = await Promise.all([
  fetchAllVariants(),         // API call 1
  fetchAllPurchaseOrders(),   // API call 2 (runs at same time as 1)
  fetchAllPurchaseOrderRows() // API call 3 (runs at same time as 1 & 2)
]);
```
Instead of: call 1 → wait → call 2 → wait → call 3 → wait (slow)
It does: call 1 + 2 + 3 at once → wait for all → done (fast!)

### `process.env` — Environment Variables
```javascript
const PORT = process.env.PORT || 3000;
// ↑ Read PORT from .env file. If not set, use 3000.
```
Variables from `.env` are available as `process.env.VARIABLE_NAME`.

### Express Routing
```javascript
app.get('/status', (req, res) => {   // GET request to /status
  res.json({ message: 'hello' });    // Send JSON response
});

app.post('/sync', (req, res) => {    // POST request to /sync
  res.json({ message: 'started' });
});
```
`app.get()` = respond when someone visits the URL
`app.post()` = respond when someone sends data to the URL

### `try/catch` — Error Handling
```javascript
try {
  await katana.buildArrivalDateMap();    // Try this
} catch (error) {
  logger.error('Something went wrong');  // If it fails, handle it here
}
```
If anything inside `try` throws an error, it jumps to `catch` instead of crashing.

---

## 11. How to Debug

### Step 1: Check if the Server is Running
```bash
# SSH into the server
ssh root@159.203.85.16

# Check PM2 process status
pm2 status

# You should see:
# ┌─────────────────────────────┬────┬──────┬───────┐
# │ Name                        │ id │ mode │ status│
# ├─────────────────────────────┼────┼──────┼───────┤
# │ shopify-katana-integration  │ 0  │ fork │ online│
# └─────────────────────────────┴────┴──────┴───────┘

# If status is "errored" or "stopped":
pm2 restart shopify-katana-integration
```

### Step 2: Watch Live Logs
```bash
# On the server:
pm2 logs shopify-katana-integration

# This shows real-time output. You'll see:
# [INFO] Server running on port 3000
# [INFO] Cron scheduler started successfully
# ... (more when sync runs)

# Press Ctrl+C to stop watching
```

### Step 3: Trigger a Manual Sync and Watch
```bash
# In one terminal, watch logs:
pm2 logs shopify-katana-integration

# In another terminal (or from your laptop):
curl -X POST https://turnoffroad.duckdns.org/sync

# Watch the first terminal — you'll see every step logged
```

### Step 4: Check the Sync Result
```bash
curl https://turnoffroad.duckdns.org/status | python3 -m json.tool
# (python3 -m json.tool makes the JSON pretty-printed)
```

### Step 5: Read Log Files
```bash
# On the server:
ls ~/shopify-katana-integration/logs/
# sync-2026-02-14.log

cat ~/shopify-katana-integration/logs/sync-2026-02-14.log
# Shows every log entry from today (JSON format)
```

### Step 6: Debug Locally (on Your Laptop)

```bash
# 1. Make sure you have a .env file with valid credentials
cd ~/Documents/Projects/CloveOde/shopify-katana-integration

# 2. Install dependencies (if you haven't)
npm install

# 3. Run the server locally
node index.js

# 4. In another terminal, trigger a sync:
curl -X POST http://localhost:3000/sync

# 5. Watch the terminal output for errors
```

### Step 7: Test Individual Pieces

You can test each service separately by creating a small test script:

```javascript
// test-katana.js (create this temporarily)
require('dotenv').config();
const katana = require('./services/katana');

async function test() {
  try {
    console.log('Testing Katana connection...');
    const variants = await katana.fetchAllVariants();
    console.log('Variants found:', variants.length);
    console.log('First variant:', JSON.stringify(variants[0], null, 2));
  } catch (error) {
    console.error('ERROR:', error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
    }
  }
}

test();
```

Run it:
```bash
node test-katana.js
```

### Common Debug Commands
```bash
# Check server health
curl https://turnoffroad.duckdns.org/

# Check if .env is loaded (from server)
pm2 env 0 | grep KATANA    # Shows env vars for the PM2 process

# Restart after code changes
cd ~/shopify-katana-integration && git pull && pm2 restart shopify-katana-integration

# Check memory usage (important for 512MB server)
free -h

# Check PM2 error logs specifically
pm2 logs shopify-katana-integration --err

# See last 100 lines of logs
pm2 logs shopify-katana-integration --lines 100
```

---

## 12. Deployment Guide

### First Time Deploy
```bash
# 1. Push code from your laptop
git add .
git commit -m "Add Katana PO arrival date sync"
git push origin main

# 2. SSH into server
ssh root@159.203.85.16

# 3. Pull code on server
cd ~/shopify-katana-integration
git pull

# 4. Install dependencies
npm install

# 5. Set up .env
cp .env.example .env
nano .env
# Fill in all the real credentials

# 6. Restart the app
pm2 restart shopify-katana-integration

# 7. Verify it's running
pm2 status
curl https://turnoffroad.duckdns.org/

# 8. Register webhooks (one-time, already done)
curl -X POST https://turnoffroad.duckdns.org/webhooks/setup
# Save the token to .env, then restart again
nano .env  # Add KATANA_WEBHOOK_TOKEN=<token from response>
pm2 restart shopify-katana-integration

# 9. Test with manual sync
curl -X POST https://turnoffroad.duckdns.org/sync
# Wait a few seconds, then:
curl https://turnoffroad.duckdns.org/status
```

### Subsequent Deploys (After Code Changes)
```bash
# From your laptop:
git add .
git commit -m "your message"
git push

# Then SSH into server:
ssh root@159.203.85.16
cd ~/shopify-katana-integration && git pull && pm2 restart shopify-katana-integration
```

---

## 13. Common Errors & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `KATANA_API_KEY is not set` | Missing .env variable | Add `KATANA_API_KEY=xxx` to `.env`, restart PM2 |
| `SHOPIFY_STORE_URL and SHOPIFY_ACCESS_TOKEN must be set` | Missing .env variables | Add both to `.env`, restart PM2 |
| `401 Unauthorized` (Katana) | Invalid or expired API key | Generate new key in Katana Settings > API |
| `401 Unauthorized` (Shopify) | Invalid access token | Check token in Shopify Admin > Apps > Custom apps |
| `403 Forbidden` (Shopify) | Token doesn't have metafield permissions | Create new token with `write_products` scope |
| `429 Too Many Requests` | Rate limited | Our code already has delays; if still happening, increase delay in sync.js |
| `409 Sync already in progress` | You triggered /sync while one is running | Wait for current sync to finish, check /status |
| `ECONNREFUSED` | Server can't reach Katana/Shopify | Check internet on server, DNS, firewall |
| Webhook events not arriving | Webhooks not registered | Run `POST /webhooks/setup` |
| Metafield not showing in Shopify | Metafield exists but not exposed to storefront | In Shopify Admin, go to Settings > Custom data > **Variants** > add custom.* metafields with storefront access |

---

## 14. Testing Checklist

Use this checklist when testing after deployment:

```
[ ] Server is running (curl https://turnoffroad.duckdns.org/ returns JSON)
[ ] .env has all variables set
[ ] Katana API works (test-katana.js returns variants)
[ ] Shopify API works (test-shopify.js returns products)
[ ] Manual sync works (POST /sync, then GET /status shows results)
[ ] Metafields appear in Shopify admin (Products > select product > select variant > Metafields section)
[ ] SKU matching is correct (check logs for matched/skipped counts)
[ ] Cron scheduler is running (logs show "Cron scheduler started successfully")
[ ] Webhooks registered (POST /webhooks/setup returns success)
[ ] Webhook token saved in .env
[ ] Webhook events trigger sync (update a PO in Katana, check logs)
[ ] Log files are being created (ls logs/)
```
