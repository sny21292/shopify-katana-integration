# Shopify-Katana Integration Project Context

## Project Overview
Setting up a Node.js backend server on Digital Ocean to sync **Purchase Order arrival dates** from Katana MRP to **Shopify variant metafields**. The system uses both Katana webhooks (real-time) and a cron job (backup) to keep data current. This enables the Shopify storefront to display per-variant messaging like "85 units arriving Feb 28".

---

## Client Details
- **Store:** Turn Offroad LLC ([turnoffroad.com](https://turnoffroad.com))
- **Shopify Admin:** [admin.shopify.com/store/turn-offroad](https://admin.shopify.com/store/turn-offroad)
- **Products:** Off-road parts for Ford Bronco & Jeep (hard tops, bumpers, sliders, etc.)
- **Product Count:** Under 100 products

---

## Client Provided Access
- Shopify Admin access (Turn Offroad LLC organization)
- Digital Ocean invite (Droplet already created)
- Katana API login details

---

## Credentials Obtained

### Shopify (New-Style Dev Dashboard App)
- **App Name:** Katana Integration (created in Shopify Dev Dashboard)
- **Dev Dashboard:** [dev.shopify.com](https://dev.shopify.com)
- **Client ID:** `9c661db6c5f4e992b6da923f1833184c`
- **Access Token:** `shpca_xxxx` (obtained via OAuth flow, stored in .env)
- **API Scopes:** `read_products`, `write_products`
- **Store URL:** `turn-offroad.myshopify.com`
- **API Version:** `2024-10`
- **Note:** Legacy custom apps deprecated Jan 1, 2026. Used new Dev Dashboard + OAuth to get access token via temporary `/auth/install` route.

### Katana MRP
- **API Key:** Stored in .env (obtained from client)
- **Base URL:** `https://api.katanamrp.com/v1`
- **Auth:** Bearer token in Authorization header

---

## Server Details

### Digital Ocean Droplet
- **Name:** ubuntu-s-1vcpu-512mb-10gb-nyc3-01
- **OS:** Ubuntu 24.04.3 LTS (GNU/Linux 6.8.0-71-generic x86_64)
- **Specs:** 512 MB RAM / 10 GB Disk / 1 vCPU
- **IP Address:** 159.203.85.16
- **Location:** NYC3
- **Swap:** 1GB swap file added at /swapfile

### Server Software Installed
- **Node.js:** v24.13.1 (installed via NVM 0.39.7)
- **NPM:** v11.8.0
- **PM2:** v6.0.14 (process manager, auto-restart on crash/reboot)
- **Nginx:** installed as reverse proxy on port 80

### Server Access
- SSH: `ssh root@159.203.85.16` (key: `~/.ssh/gretrix`)
- Web URL: `http://159.203.85.16`
- Domain: `https://turnoffroad.duckdns.org` (DuckDNS dynamic DNS)
- Digital Ocean Console available via browser
- SFTP configured in VS Code (`.vscode/sftp.json`)

---

## Integration Plan

### Objective
Sync **expected arrival dates** from Katana Purchase Orders to Shopify **variant** metafields, so the storefront can show "X units arriving on [date]" for each variant of each product.

### What We Sync
Not stock levels — we sync **PO arrival data**:
- **Next expected arrival date** from open Purchase Orders
- **Expected incoming quantity** (ordered minus received)
- **PO number/ID** for reference

### Data Flow
```
1. Fetch ALL variants from Katana API (to get SKU ↔ variant_id mapping)
2. Fetch ALL purchase orders from Katana (filter to open: NOT_RECEIVED, PARTIALLY_RECEIVED)
3. Fetch ALL purchase order rows (filter to rows with remaining qty > 0)
4. For each PO row: link variant_id → parent PO's expected_arrival_date
5. Build map: { SKU → { nextArrivalDate, expectedQty, poNumber } }
   (pick earliest arrival date if multiple open POs for same variant)
6. Fetch ALL products from Shopify (with variants)
7. Loop through each Shopify variant:
   - Match variant's SKU against the arrival date map
   - If matched: update that VARIANT's metafields with arrival data
   - If no match: delete that VARIANT's arrival metafields (clear stale data)
8. Log results (success/failures)
```

### Katana API Endpoints Used
| Endpoint | Purpose |
|----------|---------|
| `GET /v1/variants` | Get all variants (SKU ↔ variant_id mapping) |
| `GET /v1/purchase_orders` | Get all POs (filter open, read expected_arrival_date) |
| `GET /v1/purchase_order_rows` | Get PO rows (variant_id, quantity, received_quantity) |
| `POST /v1/webhooks` | Register webhook for real-time PO updates |

### Shopify Metafields Written (on Variants — NOT Products)
Metafields are written per-variant so each variant has its own arrival data.

| Metafield | Type | Example | Purpose |
|-----------|------|---------|---------|
| `custom.next_expected_arrival_date` | date | `2026-03-15` | When stock arrives |
| `custom.next_expected_quantity` | number_integer | `85` | How many units coming |
| `custom.next_expected_po_id` | single_line_text_field | `PO-42` | Which PO it's from |

**Note:** When a variant has no open POs, these metafields are **deleted** (not set to empty) because Shopify doesn't allow blank metafield values.

### Shopify Metafield Definitions (Settings > Custom data > Variants)
These must be created in Shopify Admin under **Variants** (not Products) so they appear in the variant editor and are accessible to the storefront theme:
1. **Next Expected Arrival Date** — namespace: `custom`, key: `next_expected_arrival_date`, type: Date, storefront access: Read
2. **Next Expected Quantity** — namespace: `custom`, key: `next_expected_quantity`, type: Integer, storefront access: Read
3. **Next Expected PO ID** — namespace: `custom`, key: `next_expected_po_id`, type: Single line text, storefront access: Read

### Update Strategy (Dual)
1. **Webhooks (primary, real-time):** Katana sends PO events → our server re-syncs immediately
2. **Cron (backup):** Runs every 6 hours to catch anything webhooks miss

### Katana Webhook Events Subscribed
- `purchase_order.created`, `.updated`, `.deleted`
- `purchase_order.partially_received`, `.received`
- `purchase_order_row.created`, `.updated`, `.deleted`, `.received`

### Key Details
- **Matching Key:** SKU (shared between Katana and Shopify)
- **Data to Sync:** PO arrival dates + expected quantities
- **Product Count:** Under 100 products
- **Katana first:** Fetch variants + POs from Katana, build lookup, then match against Shopify

---

## Project Structure (Built & Deployed)
```
shopify-katana-integration/
├── index.js              # Express server (health, status, sync, webhook endpoints)
├── sync.js               # Main sync script (per-variant PO arrival date matching + orchestration)
├── services/
│   ├── katana.js          # Katana API: variants, POs, PO rows, build arrival map
│   ├── shopify.js         # Shopify API: fetch products, update/delete variant arrival metafields
│   └── webhooks.js        # Katana webhook registration + verification
├── cron/
│   └── scheduler.js       # Cron job setup (node-cron, backup sync every 6hrs)
├── utils/
│   └── logger.js          # Lightweight logger (console + daily log files)
├── logs/                  # Auto-created log files (sync-YYYY-MM-DD.log)
├── .env                   # API keys (not committed)
├── .env.example           # Template for .env variables
├── .gitignore
├── package.json
├── DOCUMENTATION.md       # Full project documentation (beginner-friendly)
└── context.md             # This file — project context & status
```

### Installed NPM Packages
- express (v5.2.1)
- dotenv (v17.3.1)
- axios (v1.13.5)
- node-cron (v4.2.1)

---

## .env Variables
```
PORT=3000

# Shopify OAuth (from Dev Dashboard — only needed for token generation)
SHOPIFY_CLIENT_ID=9c661db6c5f4e992b6da923f1833184c
SHOPIFY_CLIENT_SECRET=shpss_xxxxx

# Shopify Admin API
SHOPIFY_STORE_URL=turn-offroad.myshopify.com
SHOPIFY_ACCESS_TOKEN=shpca_xxxxx
SHOPIFY_API_VERSION=2024-10

# Katana MRP API
KATANA_API_KEY=xxxxx
KATANA_API_BASE_URL=https://api.katanamrp.com/v1

# Katana Webhooks
WEBHOOK_CALLBACK_URL=https://turnoffroad.duckdns.org/webhooks/katana
KATANA_WEBHOOK_TOKEN=xxxxx           # obtained after running POST /webhooks/setup

# Cron Schedule
SYNC_CRON_SCHEDULE=0 */6 * * *
```

---

## API Endpoints (Our Server)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Health check — server status, cron schedule, endpoint list |
| `/status` | GET | Last sync result (matches, updates, errors, duration) |
| `/sync` | POST | Manually trigger full sync (runs in background) |
| `/webhooks/katana` | POST | Receives Katana PO webhook events (auto-triggers sync) |
| `/webhooks/setup` | POST | One-time: registers PO webhooks with Katana API |

---

## Nginx Configuration (/etc/nginx/sites-available/my-app)
```nginx
server {
    listen 80;
    server_name 159.203.85.16 turnoffroad.duckdns.org;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
**Note:** SSL/HTTPS is configured for `turnoffroad.duckdns.org` (likely via Let's Encrypt / Certbot). The webhook callback URL uses HTTPS.

---

## Useful Server Commands

| Task | Command |
|------|---------|
| SSH into server | `ssh -i ~/.ssh/gretrix root@159.203.85.16` |
| Check PM2 status | `pm2 status` |
| View live logs | `pm2 logs shopify-katana-integration` |
| View last 50 logs | `pm2 logs shopify-katana-integration --lines 50` |
| Restart app | `pm2 restart shopify-katana-integration` |
| Edit env on server | `nano ~/shopify-katana-integration/.env` |
| Upload files (SCP) | `scp -i ~/.ssh/gretrix <file> root@159.203.85.16:/root/shopify-katana-integration/` |
| Upload all files | `scp -i ~/.ssh/gretrix -r index.js sync.js services/ cron/ utils/ .env package.json root@159.203.85.16:/root/shopify-katana-integration/` |
| Deploy + restart | Upload files → `ssh root@159.203.85.16 "pm2 restart shopify-katana-integration"` |
| Trigger manual sync | `curl -X POST https://turnoffroad.duckdns.org/sync` |
| Check sync status | `curl https://turnoffroad.duckdns.org/status` |
| Register webhooks | `curl -X POST https://turnoffroad.duckdns.org/webhooks/setup` |
| Check memory | `free -h` |
| Check disk | `df -h` |
| Check Nginx | `systemctl status nginx` |

---

## Setup Steps Completed
1. ✅ Accepted Digital Ocean invite, accessed existing Droplet
2. ✅ Updated system packages (apt update && upgrade)
3. ✅ Rebooted server
4. ✅ Added 1GB swap file (for 512MB RAM server)
5. ✅ Installed NVM + Node.js LTS (v24.13.1)
6. ✅ PM2 already installed (v6.0.14)
7. ✅ Installed Nginx as reverse proxy
8. ✅ Created Express app (~/shopify-katana-integration)
9. ✅ Installed npm packages (express, dotenv, axios, node-cron)
10. ✅ Started app with PM2 + configured startup
11. ✅ Configured Nginx reverse proxy (port 80 → 3000)
12. ✅ Verified server is running at http://159.203.85.16
13. ✅ Set up SSH key access from laptop (key: ~/.ssh/gretrix)
14. ✅ Set up GitHub repository with deploy key
15. ✅ Created .gitignore and pushed initial commit
16. ✅ Built Katana service (variants, POs, PO rows, arrival date map)
17. ✅ Built Shopify service (fetch products, update arrival metafields)
18. ✅ Built sync script (PO arrival date matching logic)
19. ✅ Set up cron scheduler (node-cron, backup every 6 hours)
20. ✅ Added Katana webhook support (subscribe + receive PO events)
21. ✅ Added logging (daily log files + console output)
22. ✅ Created DOCUMENTATION.md (full project docs, beginner-friendly)
23. ✅ Created Shopify app in Dev Dashboard ("Katana Integration")
24. ✅ Obtained Shopify access token via OAuth flow
25. ✅ Obtained Katana API key from client
26. ✅ Deployed code to server (SFTP upload + PM2 restart)
27. ✅ Server running with all services online
28. ✅ Created metafield definitions in Shopify Admin (Settings > Custom data > Products)
29. ✅ Ran first sync on selected products — data verified correct by client (Cole)
30. ✅ Verified Katana API response fields match (variant.sku, PO.expected_arrival_date, PO row.quantity/received_quantity)
31. ✅ Verified metafields appear on products in Shopify Admin
32. ✅ Registered domain: `turnoffroad.duckdns.org` (DuckDNS dynamic DNS with SSL)
33. ✅ Registered Katana webhooks at `https://turnoffroad.duckdns.org/webhooks/katana`
34. ✅ Saved webhook token to .env as KATANA_WEBHOOK_TOKEN

## Client Feedback (from Cole)
- ✅ Confirmed: data looks correct for test products
- ✅ Confirmed: received items on PO should not pull into Shopify → **already handled** (code skips rows where remaining qty <= 0)
- ✅ Confirmed: multiple POs for same SKU should show soonest date → **already handled** (code sorts by arrival date, picks earliest)
- Requested: if arrival date has passed → show canned response like "Ships in 7-10 days" → **frontend team will handle** (metafield stores real date, theme checks if past)
- Requested: if no POs exist for a SKU → show canned response → **frontend team will handle** (metafields are deleted when no open POs, theme shows fallback)
- Requested: backorder scenario (sold more than incoming) → show next PO → **already handled** (code tracks all open POs, shows soonest date + total inbound qty)

## Still TODO
- [ ] Test webhook end-to-end: update a PO in Katana, verify sync triggers automatically via webhook
- [ ] Run full sync across all products: `curl -X POST https://turnoffroad.duckdns.org/sync`
- [ ] Frontend team: add Liquid theme logic for past-date canned response ("Ships in 7-10 days")
- [ ] Frontend team: add Liquid theme logic for missing-metafield canned response
- [ ] Consider upgrading Droplet to 1GB RAM if needed

---

## Developer Info
- **Developer:** Sunil Sharma
- **Experience:** 7 years in HTML, JavaScript, PHP, WordPress, Laravel, Shopify
- **Currently Learning:** React, Next.js, Node.js
- **Note:** First time setting up Digital Ocean / Linux server

---

## Key Decisions & Notes
- **Shopify legacy custom apps deprecated** (Jan 1, 2026). Used new Dev Dashboard + OAuth flow instead. Temporary `/auth/install` and `/auth/callback` routes were added to get the token, then removed.
- **Access token prefix:** New Dev Dashboard apps use `shpca_` prefix (not `shpat_`). Both work the same way with the Admin API.
- **Client Secret prefix:** `shpss_` — this is NOT the access token. Don't confuse them.
- **Variant-level metafields (updated):** Metafields are now written on each **variant** (not the product). Namespace changed from `katana` to `custom`. Key `next_expected_qty` renamed to `next_expected_quantity`.
- **Clearing logic (updated):** When a variant has no open POs, metafields are **deleted** rather than set to empty/zero. Shopify does not allow blank metafield values.
- **Katana pagination (updated):** Uses `x-pagination` response header with page-number pagination (increments `page` parameter, checks `last_page` field) instead of cursor-based.
- **Webhook strategy:** Webhooks are the primary update mechanism. Cron is backup only. Both trigger the same `runSync()` function.
- **Rate limiting:** 550ms delay between Shopify API calls per variant to stay within rate limits.
- **Concurrency protection:** A `syncInProgress` flag prevents overlapping syncs from manual trigger, cron, and webhooks.
- **Product-level functions kept as legacy:** `updateArrivalMetafields()` and `clearArrivalMetafields()` still exist in `shopify.js` but are no longer called by the sync. They write to products instead of variants and could be removed if not needed.
