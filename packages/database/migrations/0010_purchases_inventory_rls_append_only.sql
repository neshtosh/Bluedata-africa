-- Custom migration: FORCE row-level security on the new ops tables, and make the stock ledger
-- append-only for the application (DATABASE.md principle 7: ledgers are never updated or
-- deleted; corrections are new movements). Other privileges come from the defaults in 0004.
ALTER TABLE ops.purchases           FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ops.purchase_lines      FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ops.batches             FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ops.inventory_movements FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ops.inventory_balances  FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON ops.inventory_movements FROM app_runtime;
--> statement-breakpoint
-- Batches record what arrived; they are never rewritten or removed by the application.
REVOKE UPDATE, DELETE, TRUNCATE ON ops.batches FROM app_runtime;
