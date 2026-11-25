# syntax=docker/dockerfile:1.7
# Next.js product apps (standalone output). Build from the repo root:
#   docker build -f infra/docker/web.Dockerfile --build-arg APP=samakios-web \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.africa -t blue-samakios-web .
# NEXT_PUBLIC_* values are inlined into the browser bundle at build time, so build one image
# per environment (or move to runtime config before staging, if that becomes a burden).

FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG APP
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch --frozen-lockfile
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile --filter "@blue/${APP}..."
RUN pnpm --filter "@blue/${APP}..." run build

FROM node:24-bookworm-slim AS runtime
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000 APP=${APP}
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
USER node
EXPOSE 3000
CMD ["sh", "-c", "exec node apps/${APP}/server.js"]
