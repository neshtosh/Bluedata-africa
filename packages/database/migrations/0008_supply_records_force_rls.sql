-- Custom migration: FORCE row-level security on the new ops table. Privileges for app_runtime
-- come from the default privileges set in 0004, so no GRANTs are needed here.
ALTER TABLE ops.supply_records FORCE ROW LEVEL SECURITY;
