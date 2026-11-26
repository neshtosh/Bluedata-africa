CREATE TABLE "ops"."supply_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"catalogue_item_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unit_code" text NOT NULL,
	"quantity_kg" numeric(14, 3) NOT NULL,
	"available_from" date NOT NULL,
	"available_until" date,
	"asking_price_minor" bigint,
	"currency" char(3),
	"location" text,
	"notes" text,
	"status" text DEFAULT 'available' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "supply_records_org_id_key" UNIQUE("organisation_id","id"),
	CONSTRAINT "supply_records_origin_valid" CHECK ("ops"."supply_records"."origin" in ('wild', 'farmed')),
	CONSTRAINT "supply_records_status_valid" CHECK ("ops"."supply_records"."status" in ('available', 'reserved', 'purchased', 'withdrawn')),
	CONSTRAINT "supply_records_quantity_positive" CHECK ("ops"."supply_records"."quantity" > 0 and "ops"."supply_records"."quantity_kg" > 0),
	CONSTRAINT "supply_records_dates_ordered" CHECK ("ops"."supply_records"."available_until" is null or "ops"."supply_records"."available_until" >= "ops"."supply_records"."available_from"),
	CONSTRAINT "supply_records_price_has_currency" CHECK (("ops"."supply_records"."asking_price_minor" is null) = ("ops"."supply_records"."currency" is null) and ("ops"."supply_records"."asking_price_minor" is null or "ops"."supply_records"."asking_price_minor" >= 0))
);
--> statement-breakpoint
ALTER TABLE "ops"."supply_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."supply_records" ADD CONSTRAINT "supply_records_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."supply_records" ADD CONSTRAINT "supply_records_unit_code_units_code_fk" FOREIGN KEY ("unit_code") REFERENCES "ref"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."supply_records" ADD CONSTRAINT "supply_records_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "ref"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."supply_records" ADD CONSTRAINT "supply_records_partner_fk" FOREIGN KEY ("organisation_id","partner_id") REFERENCES "ops"."trading_partners"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."supply_records" ADD CONSTRAINT "supply_records_item_fk" FOREIGN KEY ("organisation_id","catalogue_item_id") REFERENCES "ops"."catalogue_items"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "supply_records_org_status_idx" ON "ops"."supply_records" USING btree ("organisation_id","status","available_from");--> statement-breakpoint
CREATE INDEX "supply_records_org_partner_idx" ON "ops"."supply_records" USING btree ("organisation_id","partner_id");--> statement-breakpoint
CREATE INDEX "supply_records_org_item_idx" ON "ops"."supply_records" USING btree ("organisation_id","catalogue_item_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops"."supply_records" AS PERMISSIVE FOR ALL TO public USING ("ops"."supply_records"."organisation_id" = app.current_org_id()) WITH CHECK ("ops"."supply_records"."organisation_id" = app.current_org_id());