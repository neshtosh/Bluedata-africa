CREATE TABLE "ops"."batches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"number" text NOT NULL,
	"catalogue_item_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"supplier_partner_id" uuid,
	"purchase_line_id" uuid,
	"catch_or_harvest_date" date NOT NULL,
	"received_on" date NOT NULL,
	"quantity_kg_received" numeric(14, 3) NOT NULL,
	"cost_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "batches_org_id_key" UNIQUE("organisation_id","id"),
	CONSTRAINT "batches_org_number_key" UNIQUE("organisation_id","number"),
	CONSTRAINT "batches_origin_valid" CHECK ("ops"."batches"."origin" in ('wild', 'farmed')),
	CONSTRAINT "batches_received_positive" CHECK ("ops"."batches"."quantity_kg_received" > 0 and "ops"."batches"."cost_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ops"."batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."inventory_balances" (
	"organisation_id" uuid NOT NULL,
	"batch_id" uuid PRIMARY KEY NOT NULL,
	"quantity_kg" numeric(14, 3) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_balances_not_negative" CHECK ("ops"."inventory_balances"."quantity_kg" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ops"."inventory_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."inventory_movements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"movement_type" text NOT NULL,
	"quantity_kg" numeric(14, 3) NOT NULL,
	"reference_type" text NOT NULL,
	"reference_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_movements_type_valid" CHECK ("ops"."inventory_movements"."movement_type" in ('receipt', 'sale_issue', 'transfer_out', 'transfer_in', 'processing_in', 'processing_out', 'adjustment_gain', 'adjustment_loss', 'loss')),
	CONSTRAINT "inventory_movements_not_zero" CHECK ("ops"."inventory_movements"."quantity_kg" <> 0)
);
--> statement-breakpoint
ALTER TABLE "ops"."inventory_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."purchase_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"purchase_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"catalogue_item_id" uuid NOT NULL,
	"supply_record_id" uuid,
	"origin" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_code" text NOT NULL,
	"quantity_kg" numeric(14, 3) NOT NULL,
	"unit_price_minor" bigint NOT NULL,
	"line_total_minor" bigint NOT NULL,
	CONSTRAINT "purchase_lines_org_id_key" UNIQUE("organisation_id","id"),
	CONSTRAINT "purchase_lines_purchase_line_no_key" UNIQUE("purchase_id","line_no"),
	CONSTRAINT "purchase_lines_origin_valid" CHECK ("ops"."purchase_lines"."origin" in ('wild', 'farmed')),
	CONSTRAINT "purchase_lines_quantity_positive" CHECK ("ops"."purchase_lines"."quantity" > 0 and "ops"."purchase_lines"."quantity_kg" > 0),
	CONSTRAINT "purchase_lines_money_not_negative" CHECK ("ops"."purchase_lines"."unit_price_minor" >= 0 and "ops"."purchase_lines"."line_total_minor" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ops"."purchase_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"number" text NOT NULL,
	"partner_id" uuid NOT NULL,
	"purchase_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" char(3) NOT NULL,
	"total_minor" bigint NOT NULL,
	"location" text,
	"notes" text,
	"confirmed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "purchases_org_id_key" UNIQUE("organisation_id","id"),
	CONSTRAINT "purchases_org_number_key" UNIQUE("organisation_id","number"),
	CONSTRAINT "purchases_status_valid" CHECK ("ops"."purchases"."status" in ('draft', 'confirmed', 'cancelled')),
	CONSTRAINT "purchases_total_not_negative" CHECK ("ops"."purchases"."total_minor" >= 0),
	CONSTRAINT "purchases_status_timestamps" CHECK (("ops"."purchases"."status" = 'confirmed') = ("ops"."purchases"."confirmed_at" is not null) and ("ops"."purchases"."status" = 'cancelled') = ("ops"."purchases"."cancelled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "ops"."purchases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."batches" ADD CONSTRAINT "batches_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."batches" ADD CONSTRAINT "batches_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "ref"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."batches" ADD CONSTRAINT "batches_item_fk" FOREIGN KEY ("organisation_id","catalogue_item_id") REFERENCES "ops"."catalogue_items"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."batches" ADD CONSTRAINT "batches_supplier_fk" FOREIGN KEY ("organisation_id","supplier_partner_id") REFERENCES "ops"."trading_partners"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."batches" ADD CONSTRAINT "batches_purchase_line_fk" FOREIGN KEY ("organisation_id","purchase_line_id") REFERENCES "ops"."purchase_lines"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."inventory_balances" ADD CONSTRAINT "inventory_balances_batch_fk" FOREIGN KEY ("organisation_id","batch_id") REFERENCES "ops"."batches"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."inventory_movements" ADD CONSTRAINT "inventory_movements_batch_fk" FOREIGN KEY ("organisation_id","batch_id") REFERENCES "ops"."batches"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."purchase_lines" ADD CONSTRAINT "purchase_lines_unit_code_units_code_fk" FOREIGN KEY ("unit_code") REFERENCES "ref"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_fk" FOREIGN KEY ("organisation_id","purchase_id") REFERENCES "ops"."purchases"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."purchase_lines" ADD CONSTRAINT "purchase_lines_item_fk" FOREIGN KEY ("organisation_id","catalogue_item_id") REFERENCES "ops"."catalogue_items"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."purchase_lines" ADD CONSTRAINT "purchase_lines_supply_fk" FOREIGN KEY ("organisation_id","supply_record_id") REFERENCES "ops"."supply_records"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."purchases" ADD CONSTRAINT "purchases_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."purchases" ADD CONSTRAINT "purchases_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "ref"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."purchases" ADD CONSTRAINT "purchases_partner_fk" FOREIGN KEY ("organisation_id","partner_id") REFERENCES "ops"."trading_partners"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "batches_purchase_line_key" ON "ops"."batches" USING btree ("purchase_line_id") WHERE "ops"."batches"."purchase_line_id" is not null;--> statement-breakpoint
CREATE INDEX "batches_org_item_idx" ON "ops"."batches" USING btree ("organisation_id","catalogue_item_id");--> statement-breakpoint
CREATE INDEX "inventory_balances_org_idx" ON "ops"."inventory_balances" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_org_batch_idx" ON "ops"."inventory_movements" USING btree ("organisation_id","batch_id");--> statement-breakpoint
CREATE INDEX "inventory_movements_org_time_idx" ON "ops"."inventory_movements" USING btree ("organisation_id","occurred_at");--> statement-breakpoint
CREATE INDEX "purchase_lines_org_supply_idx" ON "ops"."purchase_lines" USING btree ("organisation_id","supply_record_id");--> statement-breakpoint
CREATE INDEX "purchases_org_status_date_idx" ON "ops"."purchases" USING btree ("organisation_id","status","purchase_date");--> statement-breakpoint
CREATE INDEX "purchases_org_partner_idx" ON "ops"."purchases" USING btree ("organisation_id","partner_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops"."batches" AS PERMISSIVE FOR ALL TO public USING ("ops"."batches"."organisation_id" = app.current_org_id()) WITH CHECK ("ops"."batches"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops"."inventory_balances" AS PERMISSIVE FOR ALL TO public USING ("ops"."inventory_balances"."organisation_id" = app.current_org_id()) WITH CHECK ("ops"."inventory_balances"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops"."inventory_movements" AS PERMISSIVE FOR ALL TO public USING ("ops"."inventory_movements"."organisation_id" = app.current_org_id()) WITH CHECK ("ops"."inventory_movements"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops"."purchase_lines" AS PERMISSIVE FOR ALL TO public USING ("ops"."purchase_lines"."organisation_id" = app.current_org_id()) WITH CHECK ("ops"."purchase_lines"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops"."purchases" AS PERMISSIVE FOR ALL TO public USING ("ops"."purchases"."organisation_id" = app.current_org_id()) WITH CHECK ("ops"."purchases"."organisation_id" = app.current_org_id());