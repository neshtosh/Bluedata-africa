# API Specification — Blue Ecosystem Platform

> Status: **DRAFT v0.1 — Phase 1.** This defines conventions and the resource map. The machine-readable OpenAPI 3.1 document will be generated from Zod schemas in `packages/contracts` starting in Phase 2; this file stays the human-readable guide.

---

## 1. Conventions

| Topic | Convention |
|---|---|
| Style | REST, JSON, resource-oriented. Base path `/v1`. |
| Versioning | URI major version (`/v1`). Additive changes do not bump the version. Breaking changes → `/v2` with a deprecation window and `Deprecation`/`Sunset` headers. |
| Tenancy | Tenant resources are nested under **`/v1/orgs/{orgId}/…`**. The org in the path must match an active membership of the caller (or the API key's org). Explicit in logs, cache keys and audit; no hidden header magic. |
| Non-tenant resources | `/v1/auth`, `/v1/me`, `/v1/ref`, `/v1/geo`, `/v1/intel`, `/v1/platform` (staff only). |
| Naming | Plural kebab-case paths (`/purchase-orders`), camelCase JSON fields. |
| IDs | UUIDv7 strings. Clients **may** supply `id` on create (needed for offline capture); the server rejects IDs that already exist for a different payload. |
| Timestamps | ISO 8601 UTC (`2026-11-03T08:15:00Z`); calendar dates as `YYYY-MM-DD`. |
| Money | `{ "amountMinor": "150000", "currency": "KES" }` — amount as **string** integer in minor units (avoids JS precision issues and float rounding). |
| Quantity | `{ "value": "12.500", "unit": "basin", "kg": "38.750", "conversionId": "…" }` — decimal strings. |
| Pagination | Cursor-based: `?limit=50&cursor=…` → `{ data: [...], page: { nextCursor, hasMore } }`. Max limit 200. |
| Filtering / sorting | Explicit query params per resource (`?status=confirmed&partnerId=…&from=2026-10-01`), `sort=-createdAt`. No generic query language. |
| CSRF | Browser requests with POST/PUT/PATCH/DELETE must send `X-Requested-With` (any value); otherwise `403 CSRF_HEADER_MISSING`. |
| Idempotency | **`Idempotency-Key` header required on all signed-in POSTs** (sign-in endpoints and logout are exempt). Scoped per organisation + user. Same key + same body → original response replayed; same key + different body → `409`. Retained 7 days. |
| Concurrency | `ETag` on mutable resources; updates require `If-Match` → `412 Precondition Failed` on stale version. |
| Actions | State transitions as sub-resource actions: `POST /purchases/{id}/confirm`, `POST /sales-orders/{id}/cancel`. Never mutate status via PATCH. |
| Errors | RFC 9457 `application/problem+json` (below). |
| Validation | Zod schemas shared with the frontend; unknown fields rejected on writes. |
| Localisation | `Accept-Language` affects messages and localised reference names only, never data. |
| Rate limits | `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` headers; `429` with `Retry-After`. |
| Tracing | `X-Request-Id` accepted/returned; W3C `traceparent` propagated. |

### 1.1 Error format

```json
{
  "type": "https://docs.<platform-domain>/errors/insufficient-stock",
  "title": "Insufficient stock",
  "status": 422,
  "code": "INVENTORY_INSUFFICIENT_STOCK",
  "detail": "Batch B-2026-000412 has 18.000 kg available; 25.000 kg requested.",
  "instance": "/v1/orgs/…/sales-orders/…/fulfil",
  "requestId": "01J…",
  "errors": [{ "path": "lines[0].quantity.kg", "code": "too_big", "message": "…" }]
}
```

Status code usage: `400` malformed, `401` unauthenticated, `403` authenticated but not permitted / not entitled, `404` not found **or not in your tenant** (never `403` for another tenant's resource — avoids existence leaks), `409` conflict/idempotency mismatch, `412` stale ETag, `422` business-rule violation, `429` rate-limited.

### 1.2 Authentication methods

| Client | Method |
|---|---|
| Browser apps | Session cookie (`HttpOnly`, `Secure`, `SameSite=Lax`, parent domain) + CSRF header on unsafe methods |
| PWA offline sync | Same session; queued writes replayed with their original `Idempotency-Key` |
| Machine / partner | `Authorization: Bearer <api-key>`; key bound to one org and a scope set |
| Python intelligence service (Phase 6) | Service credential with `intel.forecasts.write` scope only |

Every endpoint declares: required permission key, required product entitlement (if any), and rate-limit class. A CI test fails if any route lacks these declarations.

---

## 2. Resource map

### 2.1 Platform

| Method & path | Purpose | Permission |
|---|---|---|
| `POST /v1/auth/otp/request` | Request SMS/email OTP | public, strict rate limit |
| `POST /v1/auth/otp/verify` | Verify OTP → session. Body: `challengeId`, `phone`, `code`, and `displayName` (required for new numbers; otherwise `422 DISPLAY_NAME_REQUIRED`) | public, strict rate limit |
| `POST /v1/auth/password/login` | Password login | public, strict rate limit |
| `GET /v1/auth/methods` | Which sign-in methods this deployment offers (`otp`, `password`) — **built in 3.4a** | public |
| `POST /v1/auth/setup/inspect` · `POST /v1/auth/setup` | Setup links (ADR-019): who a link is for (masked); choose a password with it → session (signs out other sessions, accepts the inviting organisation's invitation). `404 SETUP_LINK_INVALID` when used/expired — **built in 3.4a** | public, rate-limited per IP |
| `POST /v1/orgs/{orgId}/members/{userId}/setup-link` | Setup link for an invited member who has never signed in (`409 SETUP_LINK_NOT_ALLOWED` otherwise); replaces earlier links — **built in 3.4a** | `platform.members.manage` |
| `POST /v1/auth/logout` | Revoke current session | authenticated |
| `POST /v1/auth/mfa/totp/enrol` · `/verify` | MFA | authenticated |
| `GET /v1/me` | User, memberships, roles, entitled products | authenticated |
| `GET /v1/me/sessions` · `DELETE /v1/me/sessions/{id}` | Session management | authenticated |
| `POST /v1/orgs` | Register organisation (caller becomes Owner) | authenticated |
| `GET/PATCH /v1/orgs/{orgId}` | Organisation profile | `platform.org.read` / `platform.org.update` |
| `GET/POST /v1/orgs/{orgId}/branches` | Branches | `platform.branches.*` |
| `GET/POST /v1/orgs/{orgId}/members` · `POST …/invitations` | Members & invites | `platform.members.*` |
| `GET/POST/PATCH /v1/orgs/{orgId}/roles` | Roles (custom roles later) | `platform.roles.*` |
| `GET /v1/orgs/{orgId}/subscriptions` | Plans & entitlements | `platform.billing.read` |
| `GET/POST /v1/orgs/{orgId}/data-sharing-agreements` · `POST …/{id}/revoke` | Consent management | `platform.data_sharing.manage` (Owner only by default) |
| `GET/POST /v1/orgs/{orgId}/api-keys` · `POST …/{id}/revoke` | API keys | `platform.api_keys.manage` |
| `POST /v1/orgs/{orgId}/documents` (presigned upload) · `GET …/{id}` | Documents | per linked entity |
| `GET /v1/orgs/{orgId}/notifications` · `POST …/{id}/read` | Notifications | authenticated member |
| `GET /v1/orgs/{orgId}/audit-log` | Tenant audit trail | `platform.audit.read` |
| `GET /v1/ref/species` · `/product-forms` · `/units` · `/unit-conversions` · `/currencies` · `/countries` · `/fx-rates` | Reference data | authenticated (some public) |
| `GET /v1/geo/admin-areas` · `/water-bodies` · `/sites` (bbox, type, country filters; GeoJSON via `Accept: application/geo+json`) | Geography | authenticated (public subset anonymous later) |
| `POST /v1/orgs/{orgId}/sites` | Create private site | `samakios.sites.manage` |
| `POST /v1/orgs/{orgId}/sites/{id}/propose-publication` | Submit private site to public registry | `samakios.sites.manage` |

### 2.2 SamakiOS (`/v1/orgs/{orgId}/…`, requires `samakios` entitlement)

| Resource | Endpoints | Notes |
|---|---|---|
| Trading partners | `GET/POST /partners`, `PATCH /partners/{id}` (edit, or `archived: true/false`) — **built in 3.2**. Planned: `GET /partners/{id}/statement` | Filters: `role=supplier\|buyer\|transporter`, `speciesId`, `q` (name or phone digits), `includeArchived`. Planned: `siteId` |
| Catalogue items | `GET/POST /catalogue-items`, `PATCH /catalogue-items/{id}` | species × form × grade × size |
| Supply records | `GET/POST /supply-records`, `PATCH /supply-records/{id}` (edit; `status` available / reserved / withdrawn) — **built in 3.3**. Expiry is derived from `availableUntil`, so there is no expire endpoint | Filters: `state=open\|closed\|all`, `partnerId`, `catalogueItemId`, `origin=wild\|farmed` |
| Catch records | `GET/POST /catch-records` | coop/BMU/fisher orgs |
| Harvest records | `GET/POST /harvest-records` | farm orgs |
| Purchases | `GET/POST /purchases`, `POST /purchases/{id}/confirm`, `POST /purchases/{id}/cancel` — **built in 3.4**. `POST /purchases` with `receiveNow: true` (default) is a spot purchase received in one call. Planned: `PATCH /purchases/{id}` for drafts | Filters: `status`, `partnerId`, `from`, `to`. Confirm creates batches, receipt movements and balances; lines may take up a supply offer (`supplyRecordId`) |
| Sales orders | `GET/POST /sales-orders`, `POST …/{id}/quote`, `/confirm`, `/fulfil`, `/cancel` | Fulfil allocates batches |
| Invoices | `POST /sales-orders/{id}/invoices`, `GET /invoices`, `GET /invoices/{id}/pdf`, `POST /invoices/{id}/void` | Immutable after issue |
| Payments | `GET/POST /payments`, `POST /payments/{id}/allocations`, `POST /payments/{id}/reverse` | Inbound/outbound, advances |
| Expenses | `GET/POST /expenses`, `POST /expenses/{id}/reverse` | |
| Storage locations | `GET/POST/PATCH /storage-locations` | |
| Batches | `GET /inventory/batches` — **built in 3.4** (on hand, received, cost, cost per kg, purchase). Planned: `GET /batches/{id}` with lineage and movements | Filters: `catalogueItemId`, `inStock` (default true) |
| Inventory | `GET /inventory/summary` — **built in 3.4** (kg and cost on hand per item, purchases in the last 7 days). Planned: `GET /inventory/balances` (by item, location, batch), `GET /inventory/movements`, `POST /inventory/transfers`, `POST /inventory/adjustments`, `POST /inventory/losses` | Adjustments/losses need reason; above threshold need approval permission |
| Vehicles | `GET/POST/PATCH /vehicles` | |
| Consignments | `GET/POST /consignments` | |
| Deliveries | `GET/POST /deliveries`, `POST …/{id}/dispatch`, `/confirm-delivery`, `/fail`, `GET …/{id}/events` | Confirm with delivered kg and proof document |
| Reports | `GET /reports/dashboard`, `/sales`, `/procurement`, `/inventory`, `/losses`, `/partner-performance`, `/profitability`, `/cash-flow`, `/outstanding` — each with `from`, `to`, `branchId`, `currency`; `POST /reports/{type}/exports` → async CSV/XLSX/PDF | Exports run in worker; result as document link |
| Sync (PWA) | `POST /sync/batch` | Ordered list of queued commands, each with its own idempotency key; per-command results |

### 2.3 BlueData Africa (`/v1/intel/…`, requires `bluedata` entitlement; some endpoints later public)

| Resource | Endpoints | Notes |
|---|---|---|
| Data sources & datasets | `GET /sources`, `GET /sources/{id}`, `GET /datasets` · steward: `POST/PATCH` | Licence and attribution always returned |
| Ingestion | `POST /ingestion-batches` (with uploaded document), `GET /ingestion-batches/{id}`, `GET …/{id}/issues`, `POST …/{id}/approve`, `POST …/{id}/reject`, `POST …/{id}/reprocess` | Steward/partner roles; templates via `GET /ingestion-templates/{type}.csv` |
| Manual submissions | `POST /orgs/{orgId}/price-submissions`, `POST /orgs/{orgId}/market-observations` | Field collectors; enters review queue |
| Prices | `GET /prices/observations` (filters: species, form, level, site, area, from/to, origin, verification), `GET /prices/aggregates` (period=week\|month, groupBy=site\|admin_area), `GET /prices/series` (chart-ready), `GET /prices/spreads` (market differences) | Currency param converts at query time and reports FX source |
| Production | `GET /production/statistics`, `GET /production/series` | Always includes origin & source |
| Market indicators | `GET /market/observations`, `GET /market/indicators` | Supply/demand indicators |
| Aquaculture | `GET /aquaculture/farms` (aggregated / consented), `GET /aquaculture/production`, `GET /aquaculture/water-quality` | Precise farm points only where consented |
| Geo analytics | `GET /geo/sites/{id}/nearby-markets`, `GET /geo/choropleth?indicator=…&level=…&period=…` (GeoJSON) | Pre-aggregated by admin area |
| Forecasts (Phase 6) | `GET /forecasts?target=price&speciesId=…`, `GET /forecast-runs/{id}` (model, inputs, back-test) | Intervals mandatory in schema |
| Reports | `POST /reports/exports` | Includes attribution sheet |

Every intelligence response item includes a `provenance` object:

```json
"provenance": {
  "origin": "field_collection",
  "verificationStatus": "verified",
  "source": { "id": "…", "name": "BlueData field network", "licence": "proprietary" },
  "ingestionBatchId": "…",
  "isEstimate": false
}
```

and aggregate responses include `nObservations`, `nContributors` and `suppressed`.

---

## 3. Example: spot purchase at a landing site

```http
POST /v1/orgs/0192f1c0-…/purchases
Idempotency-Key: 0192f1c4-7d2e-7c1a-9a11-…
Content-Type: application/json

{
  "id": "0192f1c4-7d2e-7c1a-9a11-3f2b…",
  "partnerId": "0192e0aa-…",
  "branchId": "0192e001-…",
  "purchaseDate": "2026-11-03",
  "siteId": "0192d777-…",
  "currency": "KES",
  "confirm": true,
  "lines": [
    {
      "catalogueItemId": "0192e5bb-…",
      "quantity": { "value": "4", "unit": "basin" },
      "unitPrice": { "amountMinor": "180000", "currency": "KES" },
      "storageLocationId": "0192e5cc-…"
    }
  ],
  "payment": { "amount": { "amountMinor": "500000", "currency": "KES" }, "method": "mobile_money", "externalRef": "SKL3X…" }
}
```

Response `201` returns the confirmed purchase with resolved `kg` per line (and the conversion used), created batch numbers, payment status `partially_paid`, and outstanding balance.

---

## 4. Contracts, OpenAPI and the typed client (implemented in Phase 2.5, ADR-016)

1. **Define** each endpoint once in `packages/contracts/src/endpoints.ts`: method, path, Zod schemas, success status, `auth`, `idempotencyKey`.
2. **Mount** it in the API with `@Endpoint(endpoints.x.y)` and declare who may call it with `@Public()`, `@SignedIn()` or `@RequirePermission(...)`.
3. **Responses** are validated against the contract and undeclared fields are stripped, in every environment.
4. **Regenerate** the committed document after changing contracts:
   ```bash
   corepack pnpm --filter @blue/api openapi:generate
   ```
   Breaking changes are refused unless you pass `--accept-breaking`. The test suite fails if `apps/api/openapi.json` is stale.
5. **Call** it from frontends with `@blue/api-client`:
   ```ts
   const api = new ApiClient({ baseUrl, clientName: 'samakios-web' });
   const org = await api.call(endpoints.orgs.get, { params: { orgId } });
   ```
   The client sends cookies, the CSRF header and Idempotency-Keys (auto-generated, or pass one when retrying from an offline queue). Errors are `ApiError` with `.code`.
6. The live document is at `/v1/openapi.json` in non-production environments.
