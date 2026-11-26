# Architecture Decision Records

Format: lightweight ADR (Context → Decision → Consequences → Alternatives).
Status values: **Proposed** (awaiting founder review) · **Accepted** · **Superseded** · **Rejected**.

All ADRs below were **Accepted** by the founder on 2026-11-03 (end of Phase 1). ADR-010 is accepted in principle; the cloud provider choice remains open.

| ID | Title | Status | Blocking Phase 2? |
|---|---|---|---|
| ADR-001 | Modular monolith with separate worker process | Accepted | Yes |
| ADR-002 | pnpm + Turborepo monorepo, flattened app layout | Accepted | Yes |
| ADR-003 | Two Next.js product apps sharing UI/contracts/client | Accepted | Yes |
| ADR-004 | Shared-schema multi-tenancy enforced by PostgreSQL RLS | Accepted | Yes |
| ADR-005 | Drizzle ORM instead of Prisma | Accepted | Yes |
| ADR-006 | UUIDv7 identifiers + per-org document numbers | Accepted | Yes |
| ADR-007 | Self-hosted, phone-first authentication with opaque sessions | Accepted | Yes |
| ADR-008 | Money in integer minor units; quantities with original unit + normalised kg | Accepted | Yes |
| ADR-009 | Offline-capable PWA for field capture; idempotency on all writes | Accepted | Yes |
| ADR-010 | Single African cloud region, containers, managed data services | Accepted | Before staging |
| ADR-011 | Transactional outbox, consent-gated and k-anonymised contribution pipeline | Accepted | Before Phase 5 |
| ADR-012 | Provenance model and separation of AI outputs | Accepted | Before Phase 4 |
| ADR-013 | MapLibre + PMTiles basemap; GeoJSON first, Martin later | Accepted | Before Phase 4 |
| ADR-014 | Python intelligence service deferred to Phase 6 | Accepted | No |
| ADR-015 | Valkey/Redis + BullMQ for queues, rate limits, cache | Accepted | Yes |
| ADR-016 | Contract-first endpoint registry; OpenAPI generated from it; client typed from it (no codegen) | Accepted (2026-11-03, increment 2.5) | — |
| ADR-017 | Container and count unit weights are per organisation, per catalogue item | Accepted (2026-11-03, increment 3.1) | — |
| ADR-018 | System role permissions are read from the code registry, not stored | Accepted (2026-11-03, increment 3.1) | — |
| ADR-019 | Pilot runs at zero cost on the founder's laptop behind a Cloudflare Tunnel; SMS deferred until funded | Accepted (2026-11-26; revised the same day from an Oracle free VM) | Yes |

---

## ADR-001 — Modular monolith with separate worker process

**Context.** Small team; core flows (purchase → stock → balance → audit) need ACID consistency; domain boundaries will shift as we learn the market.
**Decision.** One NestJS application organised into platform, SamakiOS and BlueData module groups with enforced boundaries (dependency-cruiser rules in CI). Two entrypoints from the same image: `api` and `worker`.
**Consequences.** + Simple deploys, local dev, and transactions. + Cheap refactors. − One process failure domain (mitigated by separate worker process and horizontal API replicas). − Requires discipline on module boundaries (automated).
**Alternatives.** Microservices (rejected: ops cost, distributed transactions, premature). Serverless functions (rejected: cold starts, connection management with Postgres, harder local dev).
**Revisit when.** Triggers listed in ARCHITECTURE.md §5.

## ADR-002 — pnpm + Turborepo monorepo, flattened app layout

**Context.** Shared contracts, UI and DB schema across two frontends and one backend; founder proposed a structure with nested `apps/web/*` and several small shared packages.
**Decision.** pnpm workspaces + Turborepo. Apps: `api`, `samakios-web`, `bluedata-web`. Packages: `contracts`, `database`, `primitives`, `api-client`, `ui`, `i18n`, `config`. Workers live inside `api`. Auth/permissions logic stays in the API; only permission keys/types are shared.
**Consequences.** + One PR can change contract + backend + frontend atomically. + Affected-only CI. − Requires lint rules so `database` is never imported by frontends.
**Alternatives.** Nx (more powerful, heavier); polyrepo (rejected: contract drift).

## ADR-003 — Two Next.js product apps sharing UI, contracts and client

**Context.** Products need distinct UX, navigation, and permissions; BlueData has public/SEO pages and heavy map code; SamakiOS is a logged-in operational tool needing offline PWA behaviour.
**Decision.** `samakios-web` and `bluedata-web` as separate Next.js apps on sibling subdomains of one platform domain, sharing `@blue/ui`, `@blue/api-client`, `@blue/contracts`, `@blue/i18n`. Login/org-switcher UI is a shared package mounted in both. Session cookie on the parent domain provides single sign-on. No business logic in Next.js server code.
**Consequences.** + Independent releases, bundles and PWA configuration. + Clear product identity. − Two deploy targets; duplicated app shell (mitigated by shared packages). − Cross-product navigation is a full page load (acceptable).
**Alternatives.** One Next.js app with route groups — simpler and a valid choice for a 2-person team; rejected mainly because offline/PWA scope and public SEO surface differ, and future products (FishConnect) will be separate apps anyway. **This is the most reversible of the blocking decisions** — founder may prefer one app initially.

## ADR-004 — Shared-schema multi-tenancy enforced by PostgreSQL RLS

**Decision.** `organisation_id` on all tenant rows; RLS with `FORCE ROW LEVEL SECURITY`; per-transaction `set_config('app.org_id', …, true)`; runtime role without `BYPASSRLS`; composite FKs including `organisation_id`; cross-tenant test suite; CI check for RLS on every `ops` table. Dedicated cells for customers requiring physical isolation.
**Consequences.** + Defence in depth; fail-closed on missing context. − Every query must run inside a tenant-scoped transaction (handled by the db kernel). − Slight query-planning overhead (negligible with `organisation_id`-leading indexes).
**Alternatives.** DB/schema per tenant (ops cost), app-only filtering (fragile).

## ADR-005 — Drizzle ORM instead of Prisma

**Context.** Founder proposed Prisma. Our schema depends heavily on PostGIS geometry, RLS policies, multiple Postgres schemas, partitioned tables, exclusion/check constraints and per-transaction `SET LOCAL`.
**Decision (proposed).** Drizzle ORM with SQL migrations (Drizzle Kit generated, hand-reviewed). Spatial queries written with Drizzle's SQL template helpers and typed results.
**Consequences.** + Schema and SQL stay close to Postgres; geometry columns, RLS policies and multi-schema are expressible; light runtime, works well with transaction-mode pooling. − Less "magic" than Prisma; team writes more SQL (a benefit for this domain). − Smaller ecosystem than Prisma.
**Alternatives.** Prisma (mature DX, but PostGIS columns are `Unsupported`, spatial queries become untyped raw SQL, and RLS/partitions live in hand-edited migrations outside the schema model); Kysely (excellent query builder, but no schema/migration story of its own); TypeORM (rejected: maintenance quality).
**Reversibility.** Moderate — decide before Phase 2.

## ADR-006 — UUIDv7 identifiers + per-org document numbers

**Decision.** UUIDv7 primary keys generated in the application (works offline, time-ordered for index locality). Human document numbers per org/type/period from a locked sequence row.
**Alternatives.** bigserial (leaks volumes, can't be generated offline); UUIDv4 (poor index locality); ULID (equivalent; UUIDv7 is the standard type in Postgres).

## ADR-007 — Self-hosted, phone-first authentication with opaque sessions

**Decision.** Identity data in our PostgreSQL. Phone OTP + optional password, email optional; Argon2id; TOTP MFA mandatory for owners/admins/staff; opaque random session tokens stored hashed, cookie on parent domain; API keys for machines. Evaluate **Better Auth** in a Phase 2 spike against NestJS integration, phone OTP, organisations and API keys; fallback to a minimal in-house implementation using vetted libraries.
**Consequences.** + No per-MAU fees; full control of residency; immediate revocation. − We own security-critical code (mitigated by library, tests, external review before production).
**Alternatives.** Auth0/Clerk/Cognito (cost at scale, residency, phone-OTP cost markups); Keycloak (powerful but heavy to operate for a small team; reconsider for enterprise SSO); stateless JWT sessions (revocation problems).
**Spike outcome (2026-11-03): in-house.** Better Auth 1.7.15 was rejected after reading its source:
(1) `createSession` stores the session token in plaintext (`token: generateId(32)`), so a database leak would allow session hijacking; our design stores only a SHA-256 hash.
(2) The phone-number plugin stores OTP codes in plaintext, keyed by the plain phone number.
(3) The organization plugin brings its own organization, member, invitation and role tables, which would duplicate `tenancy.*` and sit outside our RLS model.
(4) It runs its own HTTP router beside Nest, bypassing our problem+json, validation, request-context and audit pipeline.
The implementation uses only platform primitives: `node:crypto` Argon2id (OpenSSL-backed; Node 24, no warning; OWASP parameters m=19 MiB, t=2, p=1, ~40 ms per hash), `randomBytes`, HMAC-SHA256 and `timingSafeEqual`. There are no new dependencies. An external security review is required before production.

## ADR-008 — Money and quantity representation

**Decision.** Money = `bigint` minor units + ISO 4217 code; minor-unit exponent from reference data (UGX/RWF = 0). No implicit FX conversion; FX at query time with source and date. Quantity = original value + unit + normalised kg + conversion factor/ID used. Shared `Money` and `Quantity` types in `packages/primitives` with exhaustive tests.
**Alternatives.** `numeric` money (acceptable but easier to misuse in JS); floats (rejected).

## ADR-009 — Offline-capable PWA for field capture; idempotency on all writes

**Decision.** SamakiOS is a PWA. Offline scope in MVP: create spot purchases, receipts and partner records; view cached partners, items and recent stock. Writes queued in IndexedDB with client UUIDv7 IDs and idempotency keys; replayed via `/sync/batch`. Server is authoritative: conflicting commands (e.g. stock no longer available) return per-command errors surfaced to the user.
**Consequences.** + Works on the beach. − More frontend complexity; must design conflict UX. − Offline sales fulfilment deliberately excluded (risk of overselling).
**Alternatives.** Online-only (fails the core user); native app (higher cost; revisit if PWA limits bite, e.g. background sync on low-end Android).

## ADR-010 — Single African cloud region, containers, managed data services

**Decision (proposed).** Primary region in Africa (AWS af-south-1, Azure South Africa North, or GCP africa-south1 — **provider decision pending**, leaning AWS). Containers on a managed service (e.g. ECS Fargate), managed PostgreSQL+PostGIS with PITR, managed Valkey, S3-compatible storage, CDN/WAF with East African PoPs. IaC with OpenTofu/Terraform. Frontends self-hosted as containers by default; Vercel allowed if team prefers DX.
**Consequences.** + Low latency to East Africa versus EU/US; simpler residency story; one bill. − No hyperscaler region in East Africa yet for all providers; in-country hosting needs a second "cell" when required.
**Open.** Provider (credits/startup programmes may decide), Multi-AZ from day one or from paid pilot.
**Provider decided (founder, 2026-11-03): AWS, region af-south-1 (Cape Town).**
- **Services:** ECS on Fargate, RDS for PostgreSQL with PostGIS, ElastiCache for Valkey, ECR, Secrets Manager, an Application Load Balancer, CloudWatch Logs, and S3 (documents, from Phase 3).
- **IaC and CI access:** OpenTofu, with state in S3. CI reaches AWS through GitHub OIDC (no long-lived keys).
- **Staging is single-AZ for the database and cache, to keep cost down; production goes Multi-AZ before the paid pilot.**
- **Notes:**
  - af-south-1 is an opt-in region and must be enabled in the AWS account first.
  - Its prices are higher than in US/EU regions.
  - In-country Kenyan hosting, when a customer or regulator requires it, remains a separate "cell" (same code, separate deployment).

## ADR-011 — Transactional outbox and consent-gated contribution pipeline

**Decision.** Domain events written to `system.outbox_events` in the business transaction; worker relays to BullMQ; contribution consumer checks `data_sharing_agreements`, strips identities, coarsens time/place, pseudonymises contributor; aggregates publish only with `n_contributors ≥ k` (start k=3) and dominance below threshold.
**Alternatives.** Direct reads of `ops` (rejected: isolation), CDC to warehouse (premature).

## ADR-012 — Provenance model and separation of AI outputs

**Decision.** Every intelligence row carries `origin`, `verification_status`, `source_id`, `ingestion_batch_id`. Revisions supersede, never overwrite. Forecasts/anomalies live only in their own tables with model version, inputs, intervals and back-test metrics. UI must display origin and verification.

## ADR-013 — MapLibre + PMTiles; GeoJSON first, Martin later

**Decision.** MapLibre GL JS; OSM-derived Protomaps PMTiles basemap served from object storage via CDN; thematic data as GeoJSON from the API with bbox filtering; introduce Martin for PostGIS vector tiles when layers exceed a few thousand features. Licence metadata on every layer.
**Alternatives.** Mapbox/Google (per-load cost, licence lock-in); self-hosted raster tile servers (more ops).

## ADR-014 — Python intelligence service deferred to Phase 6

**Decision.** No Python service until forecasting work starts with sufficient data. Ingestion, validation and aggregation in TypeScript workers. When built: FastAPI, `uv`, read-only access to `intel`, writes forecasts via scoped credential.

## ADR-015 — Valkey/Redis + BullMQ

**Decision.** One managed Valkey (or Redis) instance for BullMQ queues, rate-limit counters and short-lived caches. Never a source of truth.
**Alternatives.** pg-boss (Postgres-only queue; fewer components — viable, but we need Valkey for distributed rate limiting anyway); SQS (cloud lock-in, weaker local dev).

## ADR-016 — Contract-first endpoint registry (OpenAPI and client derived from it)

**Context.** ADR-002 and API.md §4 planned "Zod → OpenAPI → generated client". A generated client is a second copy of the contract that can lag behind it, and it adds a codegen step to every change.
**Decision.** Each endpoint is defined once in `@blue/contracts` (`endpoints.<group>.<name>`): method, path, Zod schemas for params, query, body and response, success status, auth (`public`/`session`) and the idempotency rule. From that single definition:
- the API mounts the route with `@Endpoint(contract)`;
- `ResponseContractInterceptor` validates every response and **strips undeclared fields in all environments** (an allowlist against accidental data leaks);
- the idempotency interceptor reads its rule and status from the contract;
- the OpenAPI 3.1 document is generated (`apps/api/openapi.json`, committed; served at `/v1/openapi.json` outside production), with `x-permission`/`x-product` taken from the access policies;
- `@blue/api-client` derives request and response types directly from the contract: no generated code.

Permissions stay in the API (`@RequirePermission`), not in contracts.
**Guards.**
- Tests fail if any mounted route isn't from the registry or a registry endpoint isn't mounted.
- Tests fail if a route's access policy disagrees with its contract's auth.
- Tests fail if `openapi.json` is out of date.
- `openapi:generate` refuses breaking changes without `--accept-breaking`.
- A real-Node module-graph test catches ESM import cycles that Vitest tolerates.

**Consequences.**
- + No drift between server, docs and client.
- + No codegen.
- + Every existing test now also checks response shapes.
- − Every endpoint needs a response schema.
- − Response validation costs a Zod parse per request (negligible at our scale; revisit under load tests).

**Alternatives.**
- OpenAPI-first with a generated client: more tooling, and drift is still possible.
- NestJS Swagger decorators: a second schema system beside Zod.
- tRPC/ts-rest: couples clients to TypeScript; partners need plain OpenAPI anyway.

## ADR-017 — Container and count unit weights are per organisation, per catalogue item

**Context.** Traders at Lake Victoria landing sites sell by the basin, tin, crate or piece. These have no standard weight: a basin of omena and a basin of tilapia differ, and so do two traders' basins. DATABASE.md originally planned a global `ref.unit_conversions` table with provenance, but no verified values exist for this market.
**Decision.** Mass units (kg, g, t) have fixed factors in `ref.units`. Count and container units have none there. Each organisation records "1 <unit> of this item = N kg" in `ops.catalogue_item_units`, and an item's default unit must be convertible to kg. The global conversion table is deferred until BlueData data stewards can publish verified regional defaults with provenance; organisations would then be able to adopt them.
**Consequences.**
- + No invented data, and conversions always reflect the business's own containers.
- + Every recorded quantity has a kg value.
- − Each organisation enters its weights once per item.

## ADR-018 — System role permissions are read from the code registry, not stored

**Context.** System roles (owner, admin, viewer) are created in every organisation. Adding a permission (e.g. `samakios.catalogue.manage`) would leave existing organisations' roles without it unless a migration rewrote `role_permissions` across all tenants, which FORCE RLS rightly prevents.
**Decision.** For `is_system` roles, `loadAccess` takes permissions from `SYSTEM_ROLES` in `@blue/contracts` at request time. `role_permissions` is used only for custom roles (later). New organisations no longer get `role_permissions` rows for system roles; existing rows are ignored.
**Consequences.**
- + Every deploy's permission changes reach every organisation immediately, with no data migration.
- − Organisations can't customise system roles; they create custom roles instead (Phase 3+, when needed).

## ADR-019 — Pilot runs at zero cost on the founder's laptop behind a Cloudflare Tunnel; SMS deferred until funded

**Context.** The founder wants a working MVP and pilot without spending money until funding arrives. The AWS af-south-1 staging setup (ADR-010) costs roughly 150–210 USD/month, and no SMS provider delivers real messages for free. An Oracle Always Free VM was chosen first, then dropped the same day in favour of the founder's own laptop.
**Decision.**
- The pilot stack (PostgreSQL + PostGIS, Valkey, API, worker, both web apps, from the existing Docker images) runs on the founder's laptop under Docker Desktop, as a **separate Compose project with its own volumes and ports**, so development resets can never touch pilot data.
- It is reached from the internet through a Cloudflare Tunnel (outbound only: no open ports, HTTPS provided by Cloudflare). Each web app forwards `/v1` to the API, so the browser talks to one origin per app and no CORS or cross-site cookie setup is needed.
- Nightly `pg_dump` backups are copied off the laptop. The founder accepted (2026-11-26) that pilot data lives on this machine without point-in-time recovery.
- Until SMS is funded, accounts are set up through one-time setup links that the inviter shares (for example on WhatsApp), and people sign in daily with phone number and password (already built). Phone OTP switches back on when a provider is contracted.
- Without a domain, Cloudflare's free quick-tunnel addresses change on every restart and the two apps need separate sign-ins. A domain on Cloudflare later gives fixed addresses and restores single sign-on through `COOKIE_DOMAIN`.
- The AWS configuration in `infra/terraform` stays maintained but unapplied; it is the post-funding path.
**Consequences.**
- + No running cost, no cloud account; data stays on hardware the founder controls.
- + No code is thrown away: the same images run on the laptop and later on AWS.
- − The pilot is only up while the laptop is on, awake, online and running Docker; power cuts and travel take it down.
- − Pilot data on a laptop that can be lost or stolen: disk encryption (BitLocker) and off-machine backups are required, not optional.
- − Setup links put identity verification on the inviter, which is acceptable only while the pilot users are known personally.
**Implemented (2026-11-26, increment 3.4a).** `infra/pilot` (Compose project `blue-pilot`, Caddy, two Cloudflare quick tunnels, `pilot.ps1`). Setup links: 256-bit tokens in the URL fragment, HMAC-stored, single use, 72 h, latest link only. Organisation owners/admins may create links only for members who have never signed in, so a link from one organisation can never take over an account used in another; the operator handles first owners and password resets.
