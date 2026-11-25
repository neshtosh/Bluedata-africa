#!/bin/sh
# Runs once, when the local Postgres volume is first initialised.
# Creates the two application roles described in DATABASE.md §5:
#   app_migrator — owns schemas and tables, runs migrations (DDL).
#   app_runtime  — used by the API and worker; DML only, never owns tables, no BYPASSRLS,
#                  so row-level security always applies to it.
# Extensions and schemas are created by migrations, not here, so every environment matches.
set -eu

psql -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_pw="$APP_MIGRATOR_PASSWORD" -v runtime_pw="$APP_RUNTIME_PASSWORD" <<'SQL'
CREATE ROLE app_migrator LOGIN PASSWORD :'migrator_pw' NOSUPERUSER NOCREATEROLE NOBYPASSRLS;
CREATE ROLE app_runtime  LOGIN PASSWORD :'runtime_pw'  NOSUPERUSER NOCREATEROLE NOBYPASSRLS;

GRANT CREATE, CONNECT ON DATABASE :"DBNAME" TO app_migrator;
GRANT CONNECT ON DATABASE :"DBNAME" TO app_runtime;

-- PostGIS and most extensions need elevated rights to install; do it once here for local dev.
-- Managed providers expose an equivalent (e.g. rds_superuser) used by IaC.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
SQL
