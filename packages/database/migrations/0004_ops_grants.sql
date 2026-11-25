-- Custom migration: privileges and FORCE RLS for the new ops schema (SamakiOS operational data).
-- Same model as tenancy (0001): app_runtime gets DML through RLS; the migrator owns the tables.

ALTER TABLE ops.catalogue_items      FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ops.catalogue_item_units FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
GRANT USAGE ON SCHEMA ops TO app_runtime;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ops TO app_runtime;
--> statement-breakpoint
-- Future ops tables are granted automatically (FORCE RLS is still added per table and enforced by
-- the catalogue check in packages/database/test/tenant-isolation.test.ts).
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA ops
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES FOR ROLE app_migrator IN SCHEMA ops
  GRANT USAGE, SELECT ON SEQUENCES TO app_runtime;
--> statement-breakpoint
-- New ref tables (species, species_names, product_forms, units) were created after 0001's
-- default privileges for ref, so app_runtime can already read them; this makes it explicit.
GRANT SELECT ON ALL TABLES IN SCHEMA ref TO app_runtime;
