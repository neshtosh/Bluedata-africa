-- Custom migration: FORCE row-level security on the new ops tables. Privileges for app_runtime
-- come from the default privileges set in 0004, so no GRANTs are needed here.
ALTER TABLE ops.trading_partners FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ops.partner_species  FORCE ROW LEVEL SECURITY;
