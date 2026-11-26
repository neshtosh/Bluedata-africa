# Blue Ecosystem Platform

> Building the digital infrastructure powering Africa's fisheries and aquaculture economy.

One shared technology platform with two initial products:

- **SamakiOS** — fisheries business management (suppliers, supply, procurement & sales, inventory, logistics, finance, reporting) for traders, processors, cooperatives, farms and distributors.
- **BlueData Africa** — fisheries intelligence: GIS, production and price data, supply/demand analytics and (later) forecasting, with provenance on every number.

Initial focus: the Lake Victoria fisheries ecosystem (Kenya, Uganda, Tanzania), then Rwanda and further markets.

## Status

**Phase 2 — Project foundation (in progress).** Architecture approved 2026-11-03. See [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md).

## Documentation

| Document                                                   | Purpose                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)               | System architecture, challenges, open questions, tenancy, GIS, data pipeline, security, deployment |
| [docs/DATABASE.md](docs/DATABASE.md)                       | Schemas, ERDs, constraints, RLS, migration strategy                                                |
| [docs/API.md](docs/API.md)                                 | API conventions and resource map                                                                   |
| [docs/DECISIONS.md](docs/DECISIONS.md)                     | Architecture decision records                                                                      |
| [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md) | Phased plan                                                                                        |
| [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md)           | Current state, blockers, next steps                                                                |

## Stack (accepted — see docs/DECISIONS.md)

TypeScript 6.0 · NestJS (Fastify) modular monolith · PostgreSQL + PostGIS · Drizzle ORM · Valkey/Redis + BullMQ · Next.js + Tailwind + Radix-based design system · MapLibre GL + PMTiles · pnpm + Turborepo · Docker · GitHub Actions · Python/FastAPI intelligence service from Phase 6.

## Getting started

Prerequisites: Node.js 24 (`.nvmrc`), Docker Desktop, Git. pnpm is pinned in `package.json` and provided by Corepack, so you don't need to install it globally.

```bash
corepack pnpm install
```

```bash
cp .env.example .env
```

```bash
corepack pnpm services:up
```

That starts PostgreSQL 17 + PostGIS 3.5 (`localhost:5432`), Valkey 8.1 (`localhost:6379`) and Mailpit (SMTP `localhost:1025`, UI http://localhost:8025). The first start creates the `app_migrator` and `app_runtime` database roles.

```bash
corepack pnpm db:migrate
```

```bash
corepack pnpm db:seed
```

```bash
corepack pnpm test
```

pnpm is also a pinned root dev dependency (same version as `packageManager`), so root scripts and Turborepo find a `pnpm` binary without a global install or admin rights. Keep the two versions in sync when upgrading.

| Command                                               | Purpose                                                      |
| ----------------------------------------------------- | ------------------------------------------------------------ |
| `corepack pnpm services:down`                         | Stop local services (data kept)                              |
| `corepack pnpm services:reset`                        | Stop and **delete** local data volumes                       |
| `corepack pnpm db:migrate` / `db:seed`                | Apply migrations / upsert reference data (as `app_migrator`) |
| `corepack pnpm format` / `format:check`               | Prettier                                                     |
| `corepack pnpm lint` / `typecheck` / `test` / `build` | Run across all workspaces via Turborepo                      |
| `corepack pnpm --filter @blue/api dev`                | API with reload on http://localhost:4000                     |
| `corepack pnpm --filter @blue/api dev:worker`         | Worker process (outbox relay, audit partitions)              |

Health checks: http://localhost:4000/health/live and http://localhost:4000/health/ready. API routes live under `/v1`; the OpenAPI document is at http://localhost:4000/v1/openapi.json. After changing contracts, run `corepack pnpm --filter @blue/api openapi:generate`.

Sign-in codes are not sent by SMS in development: look for `[DEV SMS - not delivered]` in the API log.

### Web apps

| App             | Command                                         | URL                   |
| --------------- | ----------------------------------------------- | --------------------- |
| SamakiOS        | `corepack pnpm --filter @blue/samakios-web dev` | http://localhost:3000 |
| BlueData Africa | `corepack pnpm --filter @blue/bluedata-web dev` | http://localhost:3002 |

Both call the API at `NEXT_PUBLIC_API_URL` (default `http://localhost:4000`; see each app's `.env.example`). The API's `CORS_ORIGINS` must list both app origins. One sign-in covers both apps (same session cookie). BlueData uses port 3002 because 3001 is commonly taken by other local tools.

The database and API tests start their own throwaway PostGIS and Valkey containers (Testcontainers), so Docker must be running; they don't touch your local data.

## End-to-end tests

```bash
corepack pnpm --filter @blue/e2e e2e
```

Playwright drives both web apps against a throwaway PostGIS + Valkey (Testcontainers) and the real API on port 4100 (apps on 3100/3102), so it never touches your dev servers or dev database. Locally it uses the installed Microsoft Edge; CI installs Chromium. Docker must be running.

## Docker images

```bash
docker build -f infra/docker/api.Dockerfile -t blue-api .
```

```bash
docker build -f infra/docker/web.Dockerfile --build-arg APP=samakios-web --build-arg NEXT_PUBLIC_API_URL=http://localhost:4000 -t blue-samakios-web .
```

The API image runs three roles by command: `node dist/main.api.js` (default), `node dist/main.worker.js`, and `node dist/scripts/migrate.js` (migrations + reference seed, run once per deploy as `app_migrator`). Web images are Next.js standalone servers on port 3000; `NEXT_PUBLIC_API_URL` is baked in at build time.

## Continuous integration

`.github/workflows/ci.yml` runs on every push to `main` and every pull request:

- **verify**: format check, then build, typecheck, lint and test (including Testcontainers integration tests and the OpenAPI drift check);
- **e2e**: the Playwright journeys;
- **images**: builds the three Docker images and smoke-tests each container.

**Pilot (ADR-019):** the pilot runs at zero cost on the founder's laptop behind Cloudflare tunnels — see [infra/pilot/README.md](infra/pilot/README.md).

`.github/workflows/deploy-staging.yml` (manual) deploys to staging on AWS af-south-1. The infrastructure is in `infra/terraform`; see [infra/terraform/README.md](infra/terraform/README.md). Nothing has been applied yet.

## Repository layout

```text
apps/api             NestJS modular monolith: API (main.api.ts) and worker (main.worker.ts)
apps/samakios-web    Next.js 16 — SamakiOS (operations), port 3000
apps/bluedata-web    Next.js 16 — BlueData Africa (intelligence), port 3002
packages/config      shared tsconfig presets and ESLint flat config
packages/contracts   endpoint registry, Zod schemas, permission registry (shared with frontends)
packages/api-client  typed API client derived from the contracts
packages/ui          design system: tokens (Tailwind v4), Radix-based components, app shell
packages/web-shell   shared flows: sign-in, organisations, invitations, switcher, members, i18n
packages/primitives  domain primitives (UUIDv7 IDs; money/quantity in Phase 3)
packages/database    Drizzle schema, SQL migrations, RLS policies, seeds, isolation tests
tests/e2e            Playwright journeys across both apps (isolated stack)
infra/docker         Dockerfiles (api, web) + docker-compose for local services
.github/workflows    CI
docs/                architecture, database, API, decisions, roadmap, status
```
