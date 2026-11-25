CREATE TABLE "ops"."partner_species" (
	"organisation_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"species_id" uuid NOT NULL,
	CONSTRAINT "partner_species_partner_id_species_id_pk" PRIMARY KEY("partner_id","species_id")
);
--> statement-breakpoint
ALTER TABLE "ops"."partner_species" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."trading_partners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"phone_e164" text,
	"is_supplier" boolean DEFAULT false NOT NULL,
	"is_buyer" boolean DEFAULT false NOT NULL,
	"is_transporter" boolean DEFAULT false NOT NULL,
	"production_type" text,
	"landing_site" text,
	"notes" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "trading_partners_org_id_key" UNIQUE("organisation_id","id"),
	CONSTRAINT "trading_partners_kind_valid" CHECK ("ops"."trading_partners"."kind" in ('individual', 'business', 'cooperative', 'bmu')),
	CONSTRAINT "trading_partners_production_type_valid" CHECK ("ops"."trading_partners"."production_type" is null or "ops"."trading_partners"."production_type" in ('wild', 'farmed', 'both')),
	CONSTRAINT "trading_partners_phone_format" CHECK ("ops"."trading_partners"."phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "trading_partners_has_role" CHECK ("ops"."trading_partners"."is_supplier" or "ops"."trading_partners"."is_buyer" or "ops"."trading_partners"."is_transporter")
);
--> statement-breakpoint
ALTER TABLE "ops"."trading_partners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ops"."partner_species" ADD CONSTRAINT "partner_species_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "ref"."species"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."partner_species" ADD CONSTRAINT "partner_species_partner_fk" FOREIGN KEY ("organisation_id","partner_id") REFERENCES "ops"."trading_partners"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."trading_partners" ADD CONSTRAINT "trading_partners_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "trading_partners_org_phone_key" ON "ops"."trading_partners" USING btree ("organisation_id","phone_e164") WHERE "ops"."trading_partners"."phone_e164" is not null;--> statement-breakpoint
CREATE INDEX "trading_partners_org_name_idx" ON "ops"."trading_partners" USING btree ("organisation_id","name");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops"."partner_species" AS PERMISSIVE FOR ALL TO public USING ("ops"."partner_species"."organisation_id" = app.current_org_id()) WITH CHECK ("ops"."partner_species"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops"."trading_partners" AS PERMISSIVE FOR ALL TO public USING ("ops"."trading_partners"."organisation_id" = app.current_org_id()) WITH CHECK ("ops"."trading_partners"."organisation_id" = app.current_org_id());