-- Hand-added (not generated): tenant-context helpers used by every RLS policy.
-- The API sets these per transaction with set_config(..., true) (ARCHITECTURE.md §9.2).
-- nullif(..., '') matters: once a LOCAL setting has been used in a session it reverts to ''
-- rather than NULL, and ''::uuid would raise. NULL makes every policy comparison fail closed.
CREATE SCHEMA "app";
--> statement-breakpoint
CREATE FUNCTION app.current_org_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.org_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE PARALLEL SAFE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
--> statement-breakpoint
CREATE SCHEMA "identity";
--> statement-breakpoint
CREATE SCHEMA "ref";
--> statement-breakpoint
CREATE SCHEMA "system";
--> statement-breakpoint
CREATE SCHEMA "tenancy";
--> statement-breakpoint
CREATE TABLE "identity"."otp_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"destination_hash" "bytea" NOT NULL,
	"code_hash" "bytea" NOT NULL,
	"purpose" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "otp_challenges_channel_valid" CHECK ("identity"."otp_challenges"."channel" in ('sms', 'email')),
	CONSTRAINT "otp_challenges_purpose_valid" CHECK ("identity"."otp_challenges"."purpose" in ('login', 'verify_identifier')),
	CONSTRAINT "otp_challenges_attempts_range" CHECK ("identity"."otp_challenges"."attempts" between 0 and 10)
);
--> statement-breakpoint
CREATE TABLE "identity"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" "bytea" NOT NULL,
	"active_organisation_id" uuid,
	"ip" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "identity"."user_credentials" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"secret_hash" text,
	"provider" text,
	"provider_subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_credentials_type_valid" CHECK ("identity"."user_credentials"."type" in ('password', 'totp', 'external_oidc'))
);
--> statement-breakpoint
CREATE TABLE "identity"."users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"email" "citext",
	"phone_e164" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"phone_verified_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_has_identifier" CHECK ("identity"."users"."email" is not null or "identity"."users"."phone_e164" is not null),
	CONSTRAINT "users_phone_e164_format" CHECK ("identity"."users"."phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
	CONSTRAINT "users_status_valid" CHECK ("identity"."users"."status" in ('active', 'suspended', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "ref"."countries" (
	"code" char(2) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"default_currency" char(3) NOT NULL,
	"default_timezone" text NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	CONSTRAINT "countries_code_format" CHECK ("ref"."countries"."code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "ref"."currencies" (
	"code" char(3) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"minor_units" smallint NOT NULL,
	CONSTRAINT "currencies_code_format" CHECK ("ref"."currencies"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "currencies_minor_units_range" CHECK ("ref"."currencies"."minor_units" between 0 and 4)
);
--> statement-breakpoint
CREATE TABLE "ref"."organisation_types" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref"."permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"product_code" text,
	"description" text NOT NULL,
	CONSTRAINT "permissions_key_format" CHECK ("ref"."permissions"."key" ~ '^[a-z_]+(\.[a-z_]+)+$')
);
--> statement-breakpoint
CREATE TABLE "ref"."plans" (
	"code" text PRIMARY KEY NOT NULL,
	"product_code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ref"."products" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system"."document_sequences" (
	"organisation_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"period" text NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "document_sequences_organisation_id_document_type_period_pk" PRIMARY KEY("organisation_id","document_type","period")
);
--> statement-breakpoint
ALTER TABLE "system"."document_sequences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "system"."idempotency_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"request_hash" "bytea" NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_keys_scope_key" UNIQUE NULLS NOT DISTINCT("organisation_id","user_id","key")
);
--> statement-breakpoint
ALTER TABLE "system"."idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "system"."outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid,
	"event_type" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "tenancy"."branches" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "branches_org_id_key" UNIQUE("organisation_id","id"),
	CONSTRAINT "branches_org_name_key" UNIQUE("organisation_id","name")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."branches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."data_sharing_agreements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"granularity" text NOT NULL,
	"terms_version" text NOT NULL,
	"consented_by" uuid NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "tenancy"."data_sharing_agreements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."membership_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"branch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_roles_assignment_key" UNIQUE NULLS NOT DISTINCT("membership_id","role_id","branch_id")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."membership_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text DEFAULT 'invited' NOT NULL,
	"invited_by" uuid,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_user_key" UNIQUE("organisation_id","user_id"),
	CONSTRAINT "memberships_org_id_key" UNIQUE("organisation_id","id"),
	CONSTRAINT "memberships_status_valid" CHECK ("tenancy"."memberships"."status" in ('invited', 'active', 'suspended', 'removed'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."organisation_type_assignments" (
	"organisation_id" uuid NOT NULL,
	"type_code" text NOT NULL,
	CONSTRAINT "organisation_type_assignments_organisation_id_type_code_pk" PRIMARY KEY("organisation_id","type_code")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."organisation_type_assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."organisations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"legal_name" text NOT NULL,
	"trading_name" text,
	"slug" "citext" NOT NULL,
	"country_code" char(2) NOT NULL,
	"default_currency" char(3) NOT NULL,
	"timezone" text NOT NULL,
	"tax_registration_number" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "organisations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organisations_status_valid" CHECK ("tenancy"."organisations"."status" in ('active', 'suspended', 'closed')),
	CONSTRAINT "organisations_slug_format" CHECK ("tenancy"."organisations"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "tenancy"."organisations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."role_permissions" (
	"organisation_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_key_pk" PRIMARY KEY("role_id","permission_key")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "roles_org_key_key" UNIQUE("organisation_id","key"),
	CONSTRAINT "roles_org_id_key" UNIQUE("organisation_id","id")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"organisation_id" uuid NOT NULL,
	"plan_code" text NOT NULL,
	"product_code" text NOT NULL,
	"status" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_status_valid" CHECK ("tenancy"."subscriptions"."status" in ('trialing', 'active', 'past_due', 'cancelled')),
	CONSTRAINT "subscriptions_period_valid" CHECK ("tenancy"."subscriptions"."ends_at" is null or "tenancy"."subscriptions"."ends_at" > "tenancy"."subscriptions"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."sessions" ADD CONSTRAINT "sessions_active_organisation_id_organisations_id_fk" FOREIGN KEY ("active_organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."user_credentials" ADD CONSTRAINT "user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref"."countries" ADD CONSTRAINT "countries_default_currency_currencies_code_fk" FOREIGN KEY ("default_currency") REFERENCES "ref"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref"."permissions" ADD CONSTRAINT "permissions_product_code_products_code_fk" FOREIGN KEY ("product_code") REFERENCES "ref"."products"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref"."plans" ADD CONSTRAINT "plans_product_code_products_code_fk" FOREIGN KEY ("product_code") REFERENCES "ref"."products"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system"."document_sequences" ADD CONSTRAINT "document_sequences_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system"."idempotency_keys" ADD CONSTRAINT "idempotency_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system"."outbox_events" ADD CONSTRAINT "outbox_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."branches" ADD CONSTRAINT "branches_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."data_sharing_agreements" ADD CONSTRAINT "data_sharing_agreements_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."data_sharing_agreements" ADD CONSTRAINT "data_sharing_agreements_consented_by_users_id_fk" FOREIGN KEY ("consented_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."membership_roles" ADD CONSTRAINT "membership_roles_membership_fk" FOREIGN KEY ("organisation_id","membership_id") REFERENCES "tenancy"."memberships"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."membership_roles" ADD CONSTRAINT "membership_roles_role_fk" FOREIGN KEY ("organisation_id","role_id") REFERENCES "tenancy"."roles"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."membership_roles" ADD CONSTRAINT "membership_roles_branch_fk" FOREIGN KEY ("organisation_id","branch_id") REFERENCES "tenancy"."branches"("organisation_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ADD CONSTRAINT "memberships_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ADD CONSTRAINT "memberships_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "identity"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."organisation_type_assignments" ADD CONSTRAINT "organisation_type_assignments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."organisation_type_assignments" ADD CONSTRAINT "organisation_type_assignments_type_code_organisation_types_code_fk" FOREIGN KEY ("type_code") REFERENCES "ref"."organisation_types"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."organisations" ADD CONSTRAINT "organisations_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "ref"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."organisations" ADD CONSTRAINT "organisations_default_currency_currencies_code_fk" FOREIGN KEY ("default_currency") REFERENCES "ref"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "ref"."permissions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."role_permissions" ADD CONSTRAINT "role_permissions_role_fk" FOREIGN KEY ("organisation_id","role_id") REFERENCES "tenancy"."roles"("organisation_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."roles" ADD CONSTRAINT "roles_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."subscriptions" ADD CONSTRAINT "subscriptions_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "tenancy"."organisations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."subscriptions" ADD CONSTRAINT "subscriptions_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "ref"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_challenges_destination_idx" ON "identity"."otp_challenges" USING btree ("destination_hash","created_at");--> statement-breakpoint
CREATE INDEX "sessions_active_by_user_idx" ON "identity"."sessions" USING btree ("user_id") WHERE "identity"."sessions"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "user_credentials_single_local_key" ON "identity"."user_credentials" USING btree ("user_id","type") WHERE "identity"."user_credentials"."type" <> 'external_oidc';--> statement-breakpoint
CREATE UNIQUE INDEX "user_credentials_external_key" ON "identity"."user_credentials" USING btree ("provider","provider_subject") WHERE "identity"."user_credentials"."type" = 'external_oidc';--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "identity"."users" USING btree ("email") WHERE "identity"."users"."email" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "identity"."users" USING btree ("phone_e164") WHERE "identity"."users"."phone_e164" is not null;--> statement-breakpoint
CREATE INDEX "idempotency_keys_expiry_idx" ON "system"."idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "system"."outbox_events" USING btree ("occurred_at") WHERE "system"."outbox_events"."published_at" is null;--> statement-breakpoint
CREATE INDEX "data_sharing_agreements_active_idx" ON "tenancy"."data_sharing_agreements" USING btree ("organisation_id","scope") WHERE "tenancy"."data_sharing_agreements"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "tenancy"."memberships" USING btree ("user_id");--> statement-breakpoint
-- Hand-added: used by the organisations_read policy. Runs as the caller, so the memberships
-- RLS policy still applies (a user can only see their own memberships).
CREATE FUNCTION app.is_active_member(org uuid) RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM tenancy.memberships m
      WHERE m.organisation_id = org
        AND m.user_id = app.current_user_id()
        AND m.status = 'active'
    )
  $$;
--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "system"."document_sequences" AS PERMISSIVE FOR ALL TO public USING ("system"."document_sequences"."organisation_id" = app.current_org_id()) WITH CHECK ("system"."document_sequences"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "idempotency_keys_access" ON "system"."idempotency_keys" AS PERMISSIVE FOR ALL TO public USING ("system"."idempotency_keys"."organisation_id" = app.current_org_id()
        or ("system"."idempotency_keys"."organisation_id" is null and "system"."idempotency_keys"."user_id" = app.current_user_id())) WITH CHECK ("system"."idempotency_keys"."organisation_id" = app.current_org_id()
        or ("system"."idempotency_keys"."organisation_id" is null and "system"."idempotency_keys"."user_id" = app.current_user_id()));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."branches" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."branches"."organisation_id" = app.current_org_id()) WITH CHECK ("tenancy"."branches"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."data_sharing_agreements" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."data_sharing_agreements"."organisation_id" = app.current_org_id()) WITH CHECK ("tenancy"."data_sharing_agreements"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."membership_roles" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."membership_roles"."organisation_id" = app.current_org_id()) WITH CHECK ("tenancy"."membership_roles"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "memberships_read" ON "tenancy"."memberships" AS PERMISSIVE FOR SELECT TO public USING ("tenancy"."memberships"."organisation_id" = app.current_org_id() or "tenancy"."memberships"."user_id" = app.current_user_id());--> statement-breakpoint
CREATE POLICY "memberships_write" ON "tenancy"."memberships" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."memberships"."organisation_id" = app.current_org_id()) WITH CHECK ("tenancy"."memberships"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."organisation_type_assignments" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."organisation_type_assignments"."organisation_id" = app.current_org_id()) WITH CHECK ("tenancy"."organisation_type_assignments"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "organisations_read" ON "tenancy"."organisations" AS PERMISSIVE FOR SELECT TO public USING ("tenancy"."organisations"."id" = app.current_org_id() or app.is_active_member("tenancy"."organisations"."id"));--> statement-breakpoint
CREATE POLICY "organisations_create" ON "tenancy"."organisations" AS PERMISSIVE FOR INSERT TO public WITH CHECK (app.current_user_id() is not null);--> statement-breakpoint
CREATE POLICY "organisations_update" ON "tenancy"."organisations" AS PERMISSIVE FOR UPDATE TO public USING ("tenancy"."organisations"."id" = app.current_org_id()) WITH CHECK ("tenancy"."organisations"."id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."role_permissions" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."role_permissions"."organisation_id" = app.current_org_id()) WITH CHECK ("tenancy"."role_permissions"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."roles" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."roles"."organisation_id" = app.current_org_id()) WITH CHECK ("tenancy"."roles"."organisation_id" = app.current_org_id());--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "tenancy"."subscriptions" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."subscriptions"."organisation_id" = app.current_org_id()) WITH CHECK ("tenancy"."subscriptions"."organisation_id" = app.current_org_id());