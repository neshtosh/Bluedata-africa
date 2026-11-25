-- Custom migration: everything Drizzle cannot express (DATABASE.md §5–6, ADR-004).
--   1. FORCE row-level security on every tenant table (so even the table owner obeys RLS).
--   2. Overlap protection for subscriptions (EXCLUDE constraint).
--   3. audit.audit_log: append-only, partitioned by month.
--   4. Least-privilege grants for app_runtime.

-- 1. FORCE RLS -------------------------------------------------------------------------------
ALTER TABLE tenancy.organisations                  FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.organisation_type_assignments  FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.branches                       FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.memberships                    FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.roles                          FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.role_permissions               FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.membership_roles               FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.subscriptions                  FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.data_sharing_agreements        FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE system.idempotency_keys                FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE system.document_sequences              FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2. One live subscription per organisation per product at any moment -------------------------
ALTER TABLE tenancy.subscriptions
  ADD CONSTRAINT subscriptions_no_overlap
  EXCLUDE USING gist (
    organisation_id WITH =,
    product_code WITH =,
    tstzrange(starts_at, ends_at) WITH &&
  ) WHERE (status <> 'cancelled');
--> statement-breakpoint

-- 3. Audit log --------------------------------------------------------------------------------
CREATE SCHEMA audit;
--> statement-breakpoint
CREATE TABLE audit.audit_log (
  id              uuid        NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  organisation_id uuid,
  actor_user_id   uuid,
  actor_type      text        NOT NULL
    CONSTRAINT audit_log_actor_type_valid CHECK (actor_type IN ('user', 'api_key', 'system', 'support')),
  action          text        NOT NULL,
  entity_type     text        NOT NULL,
  entity_id       uuid,
  changes         jsonb,
  request_id      text,
  ip              inet,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
--> statement-breakpoint
CREATE INDEX audit_log_org_time_idx ON audit.audit_log (organisation_id, occurred_at DESC);
--> statement-breakpoint
CREATE INDEX audit_log_entity_idx ON audit.audit_log (entity_type, entity_id);
--> statement-breakpoint
-- Catch-all so an insert never fails if the partition job falls behind.
CREATE TABLE audit.audit_log_default PARTITION OF audit.audit_log DEFAULT;
--> statement-breakpoint
-- Creates monthly partitions from the current month up to months_ahead. Idempotent.
-- SECURITY DEFINER so the worker (app_runtime) can call it without CREATE rights; partitions are
-- owned by the migrator and never granted to app_runtime directly, because RLS policies on the
-- parent table do not apply when a partition is queried directly.
CREATE FUNCTION app.ensure_audit_partitions(months_ahead int DEFAULT 3) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
  AS $$
  DECLARE
    month_start date := date_trunc('month', now())::date;
    i int;
    from_date date;
    to_date date;
    partition_name text;
  BEGIN
    FOR i IN 0..months_ahead LOOP
      from_date := (month_start + make_interval(months => i))::date;
      to_date := (from_date + interval '1 month')::date;
      partition_name := format('audit_log_%s', to_char(from_date, 'YYYY_MM'));
      IF to_regclass(format('audit.%I', partition_name)) IS NULL THEN
        EXECUTE format(
          'CREATE TABLE audit.%I PARTITION OF audit.audit_log FOR VALUES FROM (%L) TO (%L)',
          partition_name, from_date, to_date
        );
      END IF;
    END LOOP;
  END
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.ensure_audit_partitions(int) FROM PUBLIC;
--> statement-breakpoint
SELECT app.ensure_audit_partitions(3);
--> statement-breakpoint
ALTER TABLE audit.audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit.audit_log FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_read ON audit.audit_log FOR SELECT
  USING (organisation_id = app.current_org_id());
--> statement-breakpoint
-- Platform events (e.g. login) have no organisation; tenant events must match the context.
CREATE POLICY audit_append ON audit.audit_log FOR INSERT
  WITH CHECK (organisation_id IS NULL OR organisation_id = app.current_org_id());
--> statement-breakpoint

-- 4. Grants for app_runtime -------------------------------------------------------------------
GRANT USAGE ON SCHEMA app, identity, tenancy, ref, system, audit TO app_runtime;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_org_id(), app.current_user_id(), app.is_active_member(uuid),
  app.ensure_audit_partitions(int) TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA identity, tenancy, system TO app_runtime;
--> statement-breakpoint
GRANT SELECT ON ALL TABLES IN SCHEMA ref TO app_runtime;
--> statement-breakpoint
-- Append-only: no UPDATE or DELETE, and only the parent table (not partitions).
GRANT SELECT, INSERT ON audit.audit_log TO app_runtime;
--> statement-breakpoint
-- Future tables created by migrations inherit the same rules.
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA identity, tenancy, system
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA identity, tenancy, system
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA ref
  GRANT SELECT ON TABLES TO app_runtime;
