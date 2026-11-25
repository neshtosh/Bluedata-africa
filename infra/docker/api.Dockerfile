# syntax=docker/dockerfile:1.7
# One image, three roles (ADR-001), chosen by command:
#   API:     node dist/main.api.js       (default)
#   worker:  node dist/main.worker.js
#   migrate: node dist/scripts/migrate.js  (run once per deploy, before the others, as app_migrator)
# Build from the repo root:  docker build -f infra/docker/api.Dockerfile -t blue-api .

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Lockfile only: this layer (the slow download) is reused until dependencies change.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@blue/api..."
RUN pnpm --filter "@blue/api..." run build
# Self-contained production folder: the API's dist plus only its runtime dependencies.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @blue/api deploy --legacy --prod /out

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
# AWS RDS certificate authorities, so database connections can use sslmode=verify-full
# (RDS certificates are not signed by a CA in Node's default trust store).
# Kept inside /app (owned by node): creating directories under /etc here would give them the
# file's permissions and lock the node user out of /etc/ssl (OpenSSL then fails to start).
ADD --chown=node:node https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /app/rds-ca-bundle.pem
ENV NODE_EXTRA_CA_CERTS=/app/rds-ca-bundle.pem
# Never run as root.
USER node
EXPOSE 4000
CMD ["node", "dist/main.api.js"]
