CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE TABLE "ops"."catalogue_item_units" (
	"organisation_id" uuid NOT NULL,
	"catalogue_item_id" uuid NOT NULL,
	"unit_code" text NOT NULL,
	"kg_per_unit" numeric(12, 6) NOT NULL,
	CONSTRAINT "catalogue_item_units_catalogue_item_id_unit_code_pk" PRIMARY KEY("catalogue_item_id","unit_code"),
	CONSTRAINT "catalogue_item_units_positive" CHECK ("ops"."catalogue_item_units"."kg_per_unit" > 0)
);
--> statement-breakpoint
ALTER TABLE "ops"."catalogue_item_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ops"."catalogue_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"species_id" uuid NOT NULL,
	"product_form_code" text NOT NULL,
	"grade" text,
	"size_class" text,
	"default_unit_code" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "catalogue_items_org_id_key" UNIQUE("organisation_id","id"),
	CONSTRAINT "catalogue_items_identity_key" UNIQUE NULLS NOT DISTINCT("organisation_id","species_id","product_form_code","grade","size_class")
);
--> statement-breakpoint
ALTER TABLE "ops"."catalogue_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ref"."product_forms" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref"."species" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scientific_name" text NOT NULL,
	"common_name_en" text NOT NULL,
	"family" text,
	"habitat" text NOT NULL,
	"farmed" boolean DEFAULT false NOT NULL,
	CONSTRAINT "species_scientific_name_unique" UNIQUE("scientific_name"),
	CONSTRAINT "species_habitat_valid" CHECK ("ref"."species"."habitat" in ('freshwater', 'marine', 'brackish'))
);
--> statement-breakpoint
CREATE TABLE "ref"."species_names" (
	"species_id" uuid NOT NULL,
	"language" text NOT NULL,
	"country_code" char(2),
	"name" text NOT NULL,
	CONSTRAINT "species_names_species_id_language_name_pk" PRIMARY KEY("species_id","language","name")
);
--> statement-breakpoint
CREATE TABLE "ref"."units" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dimension" text NOT NULL,
	"kg_factor" numeric(12, 6),
	CONSTRAINT "units_dimension_valid" CHECK ("ref"."units"."dimension" in ('mass', 'count', 'container')),
	CONSTRAINT "units_mass_has_factor" CHECK (("ref"."units"."dimension" = 'mass') = ("ref"."units"."kg_factor" is not null))
);
--> statement-breakpoint
ALTER TABLE "ops"."catalogue_item_units" ADD CONSTRAINT "catalogue_item_units_unit_code_units_code_fk" FOREIGN KEY ("unit_code") REFERENCES "ref"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."catalogue_item_units" ADD CONSTRAINT "catalogue_item_units_item_fk" FOREIGN KEY ("organisation_id","catalogue_item_id") REFERENCES "ops"."catalogue_items"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."catalogue_items" ADD CONSTRAINT "catalogue_items_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."catalogue_items" ADD CONSTRAINT "catalogue_items_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "ref"."species"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."catalogue_items" ADD CONSTRAINT "catalogue_items_product_form_code_product_forms_code_fk" FOREIGN KEY ("product_form_code") REFERENCES "ref"."product_forms"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."catalogue_items" ADD CONSTRAINT "catalogue_items_default_unit_code_units_code_fk" FOREIGN KEY ("default_unit_code") REFERENCES "ref"."units"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref"."species_names" ADD CONSTRAINT "species_names_species_id_species_id_fk" FOREIGN KEY ("species_id") REFERENCES "ref"."species"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref"."species_names" ADD CONSTRAINT "species_names_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "ref"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalogue_items_org_species_idx" ON "ops"."catalogue_items" USING btree ("organisation_id","species_id");--> statement-breakpoint
CREATE INDEX "species_names_name_idx" ON "ref"."species_names" USING btree ("name");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops"."catalogue_item_units" AS PERMISSIVE FOR ALL TO public USING ("ops"."catalogue_item_units"."organisation_id" = app.current_org_id()) WITH CHECK ("ops"."catalogue_item_units"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ops"."catalogue_items" AS PERMISSIVE FOR ALL TO public USING ("ops"."catalogue_items"."organisation_id" = app.current_org_id()) WITH CHECK ("ops"."catalogue_items"."organisation_id" = app.current_org_id());