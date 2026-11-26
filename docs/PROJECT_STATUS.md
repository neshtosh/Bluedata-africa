# Project Status

**Current phase:** Phase 3 — SamakiOS MVP (in progress)
**Last updated:** 2026-11-26

## Phase 1 — Technical discovery & architecture ✅

Approved by the founder on 2026-11-03. All 15 ADRs in [DECISIONS.md](DECISIONS.md) are **Accepted** (ADR-010 accepted in principle; cloud provider still open). Working assumptions accepted along with them: the beachhead is traders/aggregators + small processors at Lake Victoria landing sites; offline capture of spot purchases is in the MVP; English + Swahili; a team of 2–3 engineers.

## Phase 2 progress

| Increment | Status | Verified by |
|---|---|---|
| 2.1 Monorepo skeleton (pnpm 10.34.9 via Corepack, Turborepo, Prettier, EditorConfig, git) | ✅ Done | `pnpm install` clean, `format:check` passes |
| 2.1 `packages/config` (tsconfig presets: base/node/library/nextjs; ESLint flat config) | ✅ Done | ESLint config module loads; full lint run happens once code exists |
| 2.1 Local services (`infra/docker`): PostGIS 17-3.5, Valkey 8.1, Mailpit | ✅ Done | All 3 healthy; PostGIS 3.5.2; extensions postgis, citext, pg_trgm, btree_gist; `app_migrator`/`app_runtime` created without superuser/BYPASSRLS; runtime login OK; Valkey PONG; Mailpit UI 200 |
| 2.2 `packages/primitives` (UUIDv7 IDs) | ✅ Done | 3 unit tests |
| 2.2 `packages/database`: Drizzle 0.45, schemas `app`/`identity`/`tenancy`/`ref`/`system`/`audit`, RLS + FORCE RLS, composite tenant FKs, partitioned append-only audit log, least-privilege grants, `withTenantContext`/`withUserContext`, reference seeds | ✅ Done | 17 integration tests against a throwaway PostGIS container as `app_runtime`; migrate + seed (run twice) on local DB; build/typecheck/lint pass |
| 2.3a API kernel (`apps/api`): NestJS 12 on Fastify 5, Zod-validated config, pino JSON logs with PII redaction, request IDs, RFC 9457 problem+json errors, Zod validation pipe, AsyncLocalStorage request context, `TenantDatabase` (RLS-scoped transactions), Valkey, `/health/live` + `/health/ready` | ✅ Done | 18 tests (unit + real PostGIS/Valkey containers); production build smoke-tested against local services |
| 2.3b Audit service, transactional outbox, BullMQ relay, worker process (`main.worker.ts`), audit partition maintenance | ✅ Done | 5 integration tests (atomic rollback, relay, failure + retry, worker auto-relay); worker build smoke-tested; full pipeline 12/12 tasks pass |
| 2.4 Authentication & access (`apps/api/src/platform/{identity,tenancy,access}`, `packages/contracts`): Better Auth spike → in-house (ADR-007); phone OTP (HMAC-stored codes, attempt lock, 5-min expiry), Argon2id passwords (`node:crypto`), opaque hashed sessions in HttpOnly/SameSite cookies, `/v1/me`, organisation registration (owner, system roles, pilot subscriptions), invitations + acceptance, AccessGuard (CSRF → session → membership → product → permission), Idempotency-Key replay, Valkey rate limits, CORS allowlist, `trustProxy` | ✅ Done | 57 API tests (incl. 12 OTP/session/password, 12 org/access over HTTP incl. cross-tenant 404s, idempotency replay, route-policy check); database tests; full pipeline 16/16; live sign-up → register → `/me` against the dev server |
| 2.5 Contract-first API (ADR-016): endpoint registry in `@blue/contracts`; routes mounted from it; response validation + field stripping; OpenAPI 3.1 generated (`apps/api/openapi.json`, `/v1/openapi.json` outside production) with breaking-change gate; typed `@blue/api-client` (no codegen) | ✅ Done | 7 contract tests, 9 client unit tests, 5 breaking-change tests, API↔contract consistency tests, client→live API e2e (3), real-Node module-graph test; pipeline 20/20; compiled entry modules load under `node`; live `/v1/openapi.json` on the dev server |
| 2.6 Web foundations: `@blue/ui` (navy/ocean/teal tokens, provenance colours, Inter, Radix menu, app shell, KPI tiles, empty states, inline icon set), `@blue/web-shell` (API + query providers, phone sign-in with local-number normalisation, organisations + invitations + registration, org switcher, members + invite, session/organisation gates, EN + draft SW), `samakios-web` (3000) and `bluedata-web` (3002) on Next.js 16 | ✅ Done | 5 UI + 18 web-shell tests (phone normalisation, sign-in flow incl. new-user path); both production builds; pipeline 34/34; browser checks: sign-up → name → register → dashboard (mobile and 1366px), members + invite form, single sign-on SamakiOS → BlueData, single sign-out, CORS |
| 2.7 Delivery foundations: pnpm build-script allowlist; Playwright e2e (`tests/e2e`, isolated Testcontainers stack, Edge locally / Chromium in CI); Docker images (`infra/docker/api.Dockerfile` — API/worker/migrate roles, non-root; `web.Dockerfile` — Next standalone); GitHub Actions CI (verify, e2e, images) | ✅ Done except staging | 3/3 e2e journeys pass; API image smoke-tested (entry modules, non-root user, migrate job re-run, `/health/ready` against local services); both web images (386 MB each) run as `node` and serve `/sign-in`, assets and security headers; CI workflow passes actionlint but **has not yet run on GitHub** (no remote); pipeline 36/36. **Staging (IaC, registry, deploy) blocked on the cloud provider decision** |
| 2.8 Staging on AWS af-south-1 (ADR-010): OpenTofu `infra/terraform` — state bucket bootstrap; VPC (2 AZs, private workloads, 1 NAT), HTTPS ALB with host routing, ECS Fargate (api, worker, two web apps; migrate and bootstrap-db jobs), RDS PostgreSQL 17 + PostGIS (TLS forced, PITR, deletion protection), ElastiCache Valkey (TLS), Secrets Manager, ECR, CloudWatch, budget alarm, GitHub OIDC deploy role; `deploy-staging.yml` + `infra/deploy/ecs-deploy.sh`; `NODE_ENV=staging`; `bootstrap-db` job; RDS CA bundle in the API image | ✅ Written and validated — **not applied** | `tofu validate` passes for both configurations (AWS provider 6.71.0); `tofu fmt` clean; both workflows pass actionlint; deploy script passes ShellCheck; bootstrap-db: 3 tests (fresh server, idempotent, password rotation, PG* path); config: staging mode tests; API image rebuilt and smoke-tested; pipeline 36/36. **Applying needs the founder's AWS account (af-south-1 opt-in), a domain, and a GitHub repo** |

## Decisions made during Phase 2

- **TypeScript pinned to `~6.0`** (6.0.3), not 7.x: typescript-eslint 8.72 supports only `<6.1`, and NestJS/Next.js support for TS 7 isn't confirmed. Revisit later.
- **pnpm 10** pinned via `packageManager`; pnpm 12 is available (optional upgrade).
- **Object storage emulator deferred** to Phase 3: MinIO stopped publishing community Docker images in late 2025.
- Postgres extensions are installed by the local init script (they need elevated rights); in cloud environments they'll be installed by IaC.
- **Catalogue tables live in `ref`**: products, plans, permissions and organisation types are global, read-only for `app_runtime`, and seeded, so they sit with reference data rather than in `tenancy`.
- **`system.outbox_events` is the one table without RLS**: the relay worker must read every tenant's events. Payloads carry IDs only. A dedicated relay role can tighten this later; the RLS catalogue test allowlists it explicitly.
- **Scope trimmed to what Phase 2 needs**: geo tables, species/units/conversions, FX rates and `api_keys` are deferred to the increments that first use them. `api_keys` needs a pre-authentication lookup design (key → org before any tenant context exists).
- **Tenant helper functions** (`app.current_org_id()`, `app.current_user_id()`, `app.is_active_member()`) are hand-added at the top of the first generated migration; they return NULL on missing/empty settings so policies fail closed.

- **NestJS 12 / Fastify 5 / BullMQ 6 / ioredis 6 / Zod 4** (current majors at install time).
- **Explicit `@Inject(token)` on every constructor parameter.** DI therefore doesn't depend on `emitDecoratorMetadata`, which esbuild (tsx) and Vitest don't emit. Without this rule, tests and `dev` would break silently.
- **`abortOnError: false`** on both bootstraps: Nest otherwise calls `process.abort()` on startup errors, which killed the test worker and hid the real error.
- **Request context via AsyncLocalStorage.** A per-request store is created in a Fastify `onRequest` hook and attached to the request, so 2.4's guards can set the user and organisation before handlers run inside it.
- **Error responses never leak internals.** Unknown errors become an opaque 500 with the request ID; `AppError` carries stable codes. Problem `type` URIs are `urn:blue:problem:<code>` until the docs domain exists.
- **Outbox relay is at-least-once.** BullMQ job ID = event ID (dedupe); `FOR UPDATE SKIP LOCKED` allows several workers; failures record `attempts`/`last_error` and retry on the next poll.
- **Audit partitions** are maintained by the worker on start and daily (a timer for now; moves to a BullMQ job scheduler when more scheduled jobs exist).

- **Authentication is in-house** (ADR-007 spike outcome): Better Auth stores session tokens and OTP codes in plaintext and duplicates our tenancy tables. Only `node:crypto` is used (Argon2id, HMAC-SHA256, `randomBytes`, `timingSafeEqual`); there are no new dependencies.
- **OTP SMS is sent directly after the challenge commits, not via the outbox**, because the outbox would have to persist the plaintext code.
- **OTP verify takes the phone number again**, because challenges store only an HMAC of the destination.
- **Every route declares `@Public`, `@SignedIn` or `@RequirePermission`**; undeclared routes are refused at runtime and caught by a test that walks every controller.
- **Non-members get 404 for another organisation's routes** (also for malformed IDs), never 403.
- **CSRF**: state-changing requests need an `X-Requested-With` header (plus SameSite=Lax cookies and a CORS allowlist).
- **Idempotency keys** are required on signed-in POSTs and scoped per (organisation, user); failed requests release their key; replays carry `Idempotent-Replayed: true`. `POST /v1/auth/logout` is exempt (`@NoIdempotencyKey`). Sign-in endpoints are exempt because there's no user yet.
- **Pilot subscriptions**: every new organisation gets `trialing` SamakiOS + BlueData pilot subscriptions until pricing is decided. *Confirmed by the founder on 2026-11-03; revisit when commercial plans are defined.*
- **Rwanda stays inactive**: registration in RW is refused (`COUNTRY_NOT_SUPPORTED`) until the residency review.
- **`app.is_active_member` was replaced by `app.is_member`** (migration 0002): invited users can see the organisation that invited them.
- **Production refuses to start** with `SMS_PROVIDER=log` or non-Secure cookies.

- **Endpoint registry instead of a generated client** (ADR-016): one definition drives routes, response validation, OpenAPI and client types.
- **Responses are stripped to their contract in production too**, so undeclared fields (e.g. a hash added to a query by mistake) never reach clients.
- **Bug found and fixed:** an ESM import cycle (`OpenApiController` ↔ controller list) crashed `pnpm dev` and would have crashed production, while every Vitest test passed, because Vitest tolerates such cycles. Fixed by building the list lazily. `module-graph.test.ts` now loads the entry modules in real Node; it fails with the original error if the bug is reintroduced.

- **Shared flows live in `@blue/web-shell`**, framework-agnostic (callbacks, not Next.js imports); apps are thin shells with their own navigation and dashboards (ADR-003).
- **No fake numbers**: KPI tiles take `value={null}` and render an explicit "no data" state; unbuilt modules show as "Soon" in navigation, not as dead pages.
- **Provenance badges** (official, verified, user-submitted, estimate, forecast) use a marker shape as well as colour (forecast = dashed), so they read without colour vision.
- **Phone input accepts what people type** (`0712 345 678`, `254…`, `00254…`) and normalises to E.164.
- **i18n**: a minimal typed English + Swahili catalogue for the shared flows. **The Swahili is a draft and needs native-speaker review before any pilot.** Dashboard copy is English-only for now.
- **MapLibre deferred to Phase 4** (no basemap or layers yet); **Playwright e2e deferred to 2.7** (CI), with UI flows checked by component tests and in the browser pane.
- **BlueData dev port is 3002**: 3001 was taken by another local container.
- **Bugs found in browser testing and fixed**:
  - the "Sign out" button was invisible on navy because two Tailwind colour classes conflicted; fixed with an `inverse` button variant instead of overrides;
  - the country picker was truncated;
  - the code-step links were cramped on mobile;
  - the dev SMS log line printed mojibake in the Windows console.

- **Install scripts are opt-in** (`pnpm-workspace.yaml`): only esbuild may run its postinstall. msgpackr-extract, ssh2, cpu-features and protobufjs are reviewed and ignored.
- **E2E reads sign-in codes from the API log** (the dev SMS line), so the API has no test-only backdoor. The stack uses its own ports and containers and never touches a developer's environment.
- **E2E web servers use `NEXT_DIST_DIR=.next-e2e`**, so they can run alongside a developer's `next dev`.
- **One API image, three roles** (API, worker, migrate). The migrate job applies migrations and upserts reference data, and is safe to re-run.
- **Web images bake `NEXT_PUBLIC_API_URL` at build time**: one image per environment for now. Move to runtime config before staging if that becomes a burden.
- **CI actions are pinned to major versions.** Pinning to commit SHAs (supply-chain hardening) is a Phase 7 task.

- **`NODE_ENV=staging`**: production rules (Secure cookies) but the dev SMS channel is allowed, so **staging holds synthetic data only** until an SMS provider is contracted.
- **RDS bootstrap is an ECS one-off task** (`bootstrap-db`) using the RDS-managed master secret (injected as PG* variables, never assembled into a URL); the first deploy runs it via the workflow's `bootstrap_database` input.
- **Database TLS is verified** (`sslmode=verify-full`) against the RDS CA bundle shipped in the API image.
- **Bugs caught while building this**:
  - the bootstrap job's `format()` call needed explicit `::text` casts;
  - adding the CA bundle under `/etc/ssl` made Docker create directories without the execute bit, so Node couldn't start (OpenSSL couldn't read its config); the bundle now lives in `/app`, and the smoke test re-checked it;
  - the first deploy would have migrated before the database roles existed; fixed with the bootstrap-first option;
  - scripted edits had left CRLF line endings, which would break the deploy script on Linux; normalised to LF;
  - `.terraform/` folders were leaking into the Docker build context; now in `.dockerignore`.

## Phase 3 progress (SamakiOS MVP)

| Increment | Status | Verified by |
|---|---|---|
| 3.1 Trading vocabulary: exact decimal/quantity/money primitives; `ref.species` (+ local names), `ref.product_forms`, `ref.units`; `ops` schema with `catalogue_items` and per-organisation `catalogue_item_units` (RLS, FORCE RLS, composite tenant FKs); `GET /v1/ref/vocabulary`; catalogue list/create/update/archive with unit-weight rules, duplicate and stale-version protection, audit and events; SamakiOS **Catalogue** page; permissions `samakios.catalogue.read/manage` | ✅ Done | 10 primitives tests (exact arithmetic, rounding, UGX/RWF minor units); 11 catalogue API tests (vocabulary, unit rules, contract validation, duplicates, 412 on stale edits, archiving, viewer read-only, cross-tenant 404, `PRODUCT_NOT_ENTITLED`); RLS catalogue check extended to `ops`; browser: added "omena, sun-dried, 1 basin = 18.5 kg" through the UI; pipeline 36/36; e2e 3/3 |
| 3.2 Trading partners: `ops.trading_partners` (one record per party; supplier / buyer / transporter flags; kinds individual, business, cooperative, BMU; optional E.164 phone unique per organisation; production type; free-text landing site) and `ops.partner_species` (RLS, FORCE RLS, composite tenant FK); list with `role`, `speciesId`, `q` (name or phone digits) and `includeArchived` filters; create (idempotent), edit with version check, archive / restore; audit entries carry field names only, never names or phone numbers; SamakiOS **Suppliers & buyers** page (search, filters, add, edit, archive); permissions `samakios.partners.read/manage` | ✅ Done | 11 partner API tests (multi-role create, validation, duplicate phone 409 naming the existing partner, same person in two organisations, filters and literal `%` search, 412 on stale edits, clearing fields, archive, idempotent replay, audit log holds no personal data, viewer read-only, cross-tenant 404); browser: added a BMU by local number, saw the duplicate-phone message, searched by name and phone; e2e journey extended; pipeline 36/36 (99 API tests); e2e 3/3 |
| 3.3 Supply records: `ops.supply_records` (supplier, catalogue item, wild/farmed origin, quantity as entered and in kg via the organisation's unit weights, available from/until, asking price per unit in minor units of the organisation's currency, free-text location, status available / reserved / purchased / withdrawn; composite tenant FKs to partners and items; RLS, FORCE RLS); expiry derived from `available_until` in the organisation's timezone (no scheduled job); list (`state` open/closed/all, item, supplier, origin), record, edit, reserve, release, withdraw; SamakiOS **Supply** page with "available now" kg per item | ✅ Done | 10 supply API tests (basin → kg conversion and defaults, fixed mass factors, refusing units without a weight and sub-gram quantities, supplier/item/origin/date rules, UGX without decimals, status changes with 412/409, `purchased` not settable by users, open/closed filters and expiry, viewer read-only, cross-tenant isolation incl. borrowing another tenant's partner, timezone-correct "today"); browser: recorded 3 basins → 55.5 kg at KES 1,800 per basin, reserved it; e2e journey extended (catalogue item → supply → reserve); pipeline 36/36 (109 API tests); e2e 3/3 |
| 3.3a UI refresh (founder's reference design): soft blue-grey canvas; dark slate sidebar floating with a blue brand header, blue active item and collapsible groups; transparent top bar with a pill organisation menu; white rounded panels; one action blue for both products; outlined blue secondary buttons; folder-style tabs (`FolderTabs`, keyboard arrows); inline filter bars (`Field layout="inline"`); gradient action cards (`ActionCard`, original glass artwork) on both dashboards — BlueData's are previews with no buttons until each module exists; partners and supply use tabs for role / open-closed | ✅ Done | Browser at 1366 px and 375 px (dashboard, supply, partners, sign-in, BlueData overview, mobile drawer); tabs by mouse and arrow keys; UI tests updated; pipeline 36/36; e2e 3/3 |
| 3.4 Purchases → batches → inventory: `ops.purchases` (per-organisation numbers `PO-YYYY-NNNNNN` from `system.document_sequences`; draft / confirmed / cancelled; total in minor units of the organisation's currency), `purchase_lines` (quantity as entered and in kg, price per entered unit, exact line total, optional supply offer), `batches` (`B-YYYY-NNNNNN`, origin, supplier, catch/harvest and received dates, kg and cost), `inventory_movements` (append-only stock ledger: no UPDATE/DELETE for the runtime role) and `inventory_balances` (kg per batch, `CHECK >= 0`); spot purchase received in one transaction (batch + receipt movement + balance per line, offers marked purchased, audit, outbox), drafts confirmed or cancelled later with version checks; an offer can be on only one open purchase; stock summary (kg and cost on hand per item, purchases in the last 7 days); shared trading rules module (kg conversion, currency precision, organisation "today") now used by supply and purchases; SamakiOS **Purchases** (tabs, multi-line form with live exact totals, receive/cancel drafts) and **Inventory** (figures and batches) pages, **Buy** on supply offers (pre-filled purchase), dashboard figures, recent purchases and stock by item from real data | ✅ Done | 10 purchase API tests (two-line spot purchase with exact totals, kg, sequential PO and batch numbers, cost per kg, stock summary; ledger receipt per batch; UGX whole amounts; drafts out of stock until confirmed once, 412/409; cancel drafts only; offer take-up carries unit, origin and landing date and blocks reuse; a draft holds an offer until cancelled; validation with nothing half-saved; viewer read-only; cross-tenant isolation); database: ledger and batches append-only (privilege check), RLS on all new tables; browser: bought a supply offer (3 basins → 55.5 kg, KES 5,400, PO-2026-000001 / B-2026-000001), saw it on Inventory and the dashboard; e2e journey extended (offer → Buy → receive → stock); pipeline 36/36 (119 API tests); e2e 3/3 |
| 3.4a MVP access and hosting (ADR-019): setup-link sign-in without SMS; pilot stack on the founder's laptop via Cloudflare Tunnel; off-machine backups | ⏳ Next | |
| 3.5 Inventory: balances, transfers, adjustments, losses | Pending | |
| 3.6 Sales orders/quotes, fulfilment from batches, invoices | Pending | |
| 3.7 Payments, allocations, advances; balances | Pending | |
| 3.8 Expenses; margins per sale and batch | Pending | |
| 3.9 Dashboard and core reports, exports | Pending | |
| 3.10 Offline capture of spot purchases (PWA) | Pending | |
| 3.11 Deliveries | Pending | |

Phase 3 decisions so far:
- **No invented container weights** (ADR-017).
- **System role permissions come from code** (ADR-018).
- **Species local names need local review:**

  | Species | Names seeded |
  |---|---|
  | Nile perch | mbuta / mputa / sangara |
  | Nile tilapia | ngege / sato |
  | Silver cyprinid | omena / mukene / dagaa |
  | African catfish | kambale |
  | Marbled lungfish | kamongo / mamba |
  | Haplochromines | fulu / nkejje / furu |

  These need confirmation by people at the landing sites before any pilot.

## What the isolation tests prove (packages/database/test/tenant-isolation.test.ts)

- A tenant sees only its own rows, even when querying another tenant's ID directly.
- With no tenant context, tenant tables return nothing.
- A signed-in user with no organisation selected sees only their own memberships and organisations.
- Tenant context never leaks across pooled connections.
- Inserting a row for another tenant, or moving a row into another tenant, is rejected by RLS.
- Updates and deletes cannot reach another tenant's rows.
- Composite foreign keys reject references to another tenant's records.
- Overlapping live subscriptions are rejected (exclusion constraint).
- The audit log is append-only, visible only to its own tenant, and its partitions can't be read directly.
- Reference data is read-only for the runtime role, and currency minor units are correct (UGX/RWF = 0).
- A catalogue check fails if any table in `tenancy`/`system`/`audit` lacks enabled + forced RLS and a policy.

## Commands

```bash
corepack pnpm install
```

```bash
corepack pnpm services:up
```

```bash
corepack pnpm db:migrate
```

```bash
corepack pnpm db:seed
```

```bash
corepack pnpm test
```

## Known issues / risks

- Docker Compose reads its defaults from the compose file, not the root `.env`; changing ports in `.env` needs `--env-file .env` (to be wired into scripts with the API).
- Data-protection legal opinion still outstanding (KE, UG, TZ, RW).
- No confirmed external data sources yet.
- On Windows, `localhost` may try IPv6 (`::1`) before IPv4 while the API listens on `0.0.0.0`; clients with very short timeouts (≤ 2 s) can time out on first connect. Use `127.0.0.1` or a longer timeout locally.
- No real SMS provider yet: codes appear only in the API log (`[DEV SMS - not delivered]`). Choose a provider before any pilot.
- Invitations don't notify the invitee yet (no SMS on invite); they see it on their next sign-in. Comes with the notifications module.
- Rate limiting fails closed: if Valkey is down, sign-in returns errors rather than going unthrottled.
- Idempotency edge case: if storing a response fails after the work committed, a retry within 60 s gets `409 in progress`, and a retry after that re-executes the request. Logged when it happens.
- MFA (TOTP for owners/admins) and API keys are not built yet; they were planned for 2.4 in ADR-007 and are deferred to before the pilot.
- Partner landing site is free text until the geographic registry exists (Phase 4); the planned `home_site_id` and the consented `linked_organisation_id` link are not built yet.
- Partner search is a plain substring match (name, or 3+ phone digits). Fuzzy matching (`pg_trgm`) and pagination come when an organisation has enough partners to need them; the list currently returns all matches.
- Partner statements (`/partners/{id}/statement`) wait for purchases, sales and payments (3.4 to 3.7).
- Supply records can't yet be edited from the UI (quantity, dates, price); the API supports it. Their location is free text until the geographic registry (Phase 4), and farmed origin isn't checked against a farm site yet.
- A supply record's kilograms use the item's unit weight at the time it was recorded; changing the catalogue weight later doesn't rewrite existing offers (intended: it is what was offered).
- The supply list returns every matching record; pagination comes when volumes need it.
- Taking up a supply offer marks the whole offer purchased, even if less was bought; partial take-up comes when someone needs it.
- Draft purchases can't be edited, only received or cancelled (then recorded again).
- Confirmed purchases can't be corrected yet; returns and stock adjustments arrive in 3.5.
- Batch cost is the line total only; transport, ice and levies are added as expenses (3.8) and are not yet in cost per kg.
- Stock is one balance per batch; storage locations and transfers between them come in 3.5.
- Stock value and 7-day totals count only the organisation's own currency (no exchange rates).
- Purchase and stock lists return everything; pagination comes when volumes need it.
- On phones, wide tables (partners, supply, catalogue) scroll sideways inside their panel; card-style rows for small screens would read better and are a later polish.
- The reference design's search and notification icons were left out on purpose: there is no global search or notifications yet, and the UI should not show controls that do nothing.
- `module-graph.test.ts` exceeded its 60 s budget once when the whole pipeline was building alongside it; the budget is now 180 s.
- No dark mode yet; light theme only.
- Web apps check the session client-side; the API is the real gate. Server-side rendering of signed-in pages is not needed for SamakiOS and is deferred for BlueData's public pages (Phase 4).
- Slow network on the dev machine: first-time installs and image pulls take several minutes.

- Fixed: root scripts (`db:migrate`, `db:seed`) and Turborepo failed with "'pnpm' is not recognized" because pnpm was only reachable through `corepack pnpm`. pnpm 10.34.9 is now also a pinned root dev dependency; keep it in sync with `packageManager`.
- pnpm 10 blocked optional install scripts (esbuild, ssh2, cpu-features, protobufjs). Everything works without them (esbuild ships platform binaries); decide an `onlyBuiltDependencies` allowlist before CI.
- `subscriptions.product_code` is denormalised from the plan for the exclusion constraint. Nothing yet enforces that it matches the plan's product; the billing service must set it (or add a trigger).

## Next recommended step

**MVP access and hosting (ADR-019).** So that real pilot users can use what exists so far:
- sign-in without SMS: one-time setup links created by you or an organisation owner and shared by hand (e.g. on WhatsApp), then phone number + password;
- a separate pilot Docker stack on the founder's laptop (its own database and ports, production mode), reached through a Cloudflare Tunnel, with each app forwarding `/v1` to the API;
- nightly database backups copied off the laptop, and a short runbook (start, stop, update, restore).

Then 3.5 (stock adjustments and losses) and 3.6 (sales and invoices), deployed to the pilot as they land.

The AWS staging configuration stays unapplied until funding (ADR-019); the pilot will run on the founder's laptop.
