CREATE TYPE "CommercialFeatureValueType" AS ENUM ('boolean', 'integer', 'decimal');
CREATE TYPE "CommercialPlanVisibility" AS ENUM ('public', 'private', 'internal');
CREATE TYPE "CommercialBillingInterval" AS ENUM ('monthly', 'annual', 'custom');
CREATE TYPE "WorkspaceSubscriptionStatus" AS ENUM ('trialing', 'active', 'past_due', 'grace_period', 'suspended', 'cancelled', 'read_only');
CREATE TYPE "CommercialBillingProvider" AS ENUM ('quickbooks', 'manual', 'stripe', 'paddle', 'other');

CREATE TABLE "commercial_modules" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_modules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commercial_features" (
  "id" TEXT NOT NULL,
  "module_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "value_type" "CommercialFeatureValueType" NOT NULL DEFAULT 'boolean',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_features_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "commercial_limits" (
  "id" TEXT NOT NULL,
  "module_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "unit" TEXT,
  "value_type" "CommercialFeatureValueType" NOT NULL DEFAULT 'integer',
  "is_metered" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "commercial_limits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subscription_plans" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "visibility" "CommercialPlanVisibility" NOT NULL DEFAULT 'public',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "is_legacy" BOOLEAN NOT NULL DEFAULT false,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "subscription_plan_prices" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'CAD',
  "billing_interval" "CommercialBillingInterval" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_plan_prices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plan_features" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "feature_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_features_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "plan_limits" (
  "id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "limit_id" TEXT NOT NULL,
  "value" DECIMAL(18,4),
  "is_unlimited" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "plan_limits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_subscriptions" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "status" "WorkspaceSubscriptionStatus" NOT NULL DEFAULT 'active',
  "billing_interval" "CommercialBillingInterval" NOT NULL DEFAULT 'monthly',
  "billing_provider" "CommercialBillingProvider" NOT NULL DEFAULT 'quickbooks',
  "currency" TEXT NOT NULL DEFAULT 'CAD',
  "negotiated_amount" DECIMAL(12,2),
  "current_period_start" TIMESTAMP(3),
  "current_period_end" TIMESTAMP(3),
  "trial_starts_at" TIMESTAMP(3),
  "trial_ends_at" TIMESTAMP(3),
  "grace_ends_at" TIMESTAMP(3),
  "next_billing_at" TIMESTAMP(3),
  "provider_customer_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_feature_overrides" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "feature_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "starts_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_feature_overrides_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_limit_overrides" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "limit_id" TEXT NOT NULL,
  "value" DECIMAL(18,4),
  "is_unlimited" BOOLEAN NOT NULL DEFAULT false,
  "starts_at" TIMESTAMP(3),
  "expires_at" TIMESTAMP(3),
  "reason" TEXT NOT NULL,
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "workspace_limit_overrides_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "workspace_entitlement_snapshots" (
  "agency_id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "access_mode" TEXT NOT NULL,
  "features" JSONB NOT NULL DEFAULT '{}',
  "limits" JSONB NOT NULL DEFAULT '{}',
  "sources" JSONB NOT NULL DEFAULT '{}',
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valid_until" TIMESTAMP(3),
  CONSTRAINT "workspace_entitlement_snapshots_pkey" PRIMARY KEY ("agency_id")
);

CREATE TABLE "subscription_audit_logs" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" TEXT,
  "before" JSONB,
  "after" JSONB,
  "reason" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "subscription_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commercial_modules_key_key" ON "commercial_modules"("key");
CREATE INDEX "commercial_modules_is_active_sort_order_idx" ON "commercial_modules"("is_active", "sort_order");
CREATE UNIQUE INDEX "commercial_features_key_key" ON "commercial_features"("key");
CREATE INDEX "commercial_features_module_id_is_active_sort_order_idx" ON "commercial_features"("module_id", "is_active", "sort_order");
CREATE UNIQUE INDEX "commercial_limits_key_key" ON "commercial_limits"("key");
CREATE INDEX "commercial_limits_module_id_is_active_sort_order_idx" ON "commercial_limits"("module_id", "is_active", "sort_order");
CREATE UNIQUE INDEX "subscription_plans_key_key" ON "subscription_plans"("key");
CREATE INDEX "subscription_plans_is_active_visibility_sort_order_idx" ON "subscription_plans"("is_active", "visibility", "sort_order");
CREATE UNIQUE INDEX "subscription_plan_prices_plan_id_currency_billing_interval_key" ON "subscription_plan_prices"("plan_id", "currency", "billing_interval");
CREATE INDEX "subscription_plan_prices_currency_billing_interval_is_active_idx" ON "subscription_plan_prices"("currency", "billing_interval", "is_active");
CREATE UNIQUE INDEX "plan_features_plan_id_feature_id_key" ON "plan_features"("plan_id", "feature_id");
CREATE INDEX "plan_features_feature_id_idx" ON "plan_features"("feature_id");
CREATE UNIQUE INDEX "plan_limits_plan_id_limit_id_key" ON "plan_limits"("plan_id", "limit_id");
CREATE INDEX "plan_limits_limit_id_idx" ON "plan_limits"("limit_id");
CREATE UNIQUE INDEX "workspace_subscriptions_agency_id_key" ON "workspace_subscriptions"("agency_id");
CREATE INDEX "workspace_subscriptions_plan_id_status_idx" ON "workspace_subscriptions"("plan_id", "status");
CREATE INDEX "workspace_subscriptions_status_next_billing_at_idx" ON "workspace_subscriptions"("status", "next_billing_at");
CREATE UNIQUE INDEX "workspace_feature_overrides_agency_id_feature_id_key" ON "workspace_feature_overrides"("agency_id", "feature_id");
CREATE INDEX "workspace_feature_overrides_agency_id_starts_at_expires_at_idx" ON "workspace_feature_overrides"("agency_id", "starts_at", "expires_at");
CREATE INDEX "workspace_feature_overrides_feature_id_idx" ON "workspace_feature_overrides"("feature_id");
CREATE UNIQUE INDEX "workspace_limit_overrides_agency_id_limit_id_key" ON "workspace_limit_overrides"("agency_id", "limit_id");
CREATE INDEX "workspace_limit_overrides_agency_id_starts_at_expires_at_idx" ON "workspace_limit_overrides"("agency_id", "starts_at", "expires_at");
CREATE INDEX "workspace_limit_overrides_limit_id_idx" ON "workspace_limit_overrides"("limit_id");
CREATE INDEX "workspace_entitlement_snapshots_valid_until_idx" ON "workspace_entitlement_snapshots"("valid_until");
CREATE INDEX "subscription_audit_logs_agency_id_created_at_idx" ON "subscription_audit_logs"("agency_id", "created_at");
CREATE INDEX "subscription_audit_logs_actor_user_id_created_at_idx" ON "subscription_audit_logs"("actor_user_id", "created_at");
CREATE INDEX "subscription_audit_logs_entity_type_entity_id_idx" ON "subscription_audit_logs"("entity_type", "entity_id");

ALTER TABLE "commercial_features" ADD CONSTRAINT "commercial_features_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "commercial_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commercial_limits" ADD CONSTRAINT "commercial_limits_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "commercial_modules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_plan_prices" ADD CONSTRAINT "subscription_plan_prices_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "commercial_features"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "plan_limits" ADD CONSTRAINT "plan_limits_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "plan_limits" ADD CONSTRAINT "plan_limits_limit_id_fkey" FOREIGN KEY ("limit_id") REFERENCES "commercial_limits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_subscriptions" ADD CONSTRAINT "workspace_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_feature_overrides" ADD CONSTRAINT "workspace_feature_overrides_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_feature_overrides" ADD CONSTRAINT "workspace_feature_overrides_feature_id_fkey" FOREIGN KEY ("feature_id") REFERENCES "commercial_features"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_feature_overrides" ADD CONSTRAINT "workspace_feature_overrides_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_limit_overrides" ADD CONSTRAINT "workspace_limit_overrides_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_limit_overrides" ADD CONSTRAINT "workspace_limit_overrides_limit_id_fkey" FOREIGN KEY ("limit_id") REFERENCES "commercial_limits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_limit_overrides" ADD CONSTRAINT "workspace_limit_overrides_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "workspace_entitlement_snapshots" ADD CONSTRAINT "workspace_entitlement_snapshots_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscription_audit_logs" ADD CONSTRAINT "subscription_audit_logs_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "subscription_audit_logs" ADD CONSTRAINT "subscription_audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "commercial_modules" ("id", "key", "name", "sort_order") VALUES
  ('module-core-crm', 'core_crm', 'Core CRM', 10),
  ('module-leads-sales', 'leads_sales', 'Leads & Sales', 20),
  ('module-calling', 'calling', 'Calling', 30),
  ('module-communications', 'communications', 'SMS & Communications', 40),
  ('module-case-management', 'case_management', 'Case Management', 50),
  ('module-documents-esign', 'documents_esign', 'Documents & E-Sign', 60),
  ('module-forms', 'forms_questionnaires', 'Forms & Questionnaires', 70),
  ('module-workflow', 'workflow_automation', 'Workflow Automation', 80),
  ('module-scheduling', 'scheduling', 'Scheduling', 90),
  ('module-billing', 'billing_payments', 'Billing & Payments', 100),
  ('module-quickbooks', 'quickbooks', 'QuickBooks', 110),
  ('module-client-portal', 'client_portal', 'Client Portal', 120),
  ('module-team', 'team_management', 'Team Management', 130),
  ('module-performance', 'performance_incentives', 'Performance & Incentives', 140),
  ('module-nova', 'nova_ai', 'Nova AI', 150),
  ('module-security', 'advanced_security', 'Advanced Security', 160),
  ('module-integrations', 'integrations', 'Integrations', 170);

INSERT INTO "commercial_features" ("id", "module_id", "key", "name", "sort_order") VALUES
  ('feature-core-crm', 'module-core-crm', 'core_crm', 'Core CRM', 10),
  ('feature-leads', 'module-leads-sales', 'leads', 'Leads', 20),
  ('feature-lead-automation', 'module-leads-sales', 'lead_automation', 'Lead automation', 30),
  ('feature-meta-leads', 'module-leads-sales', 'meta_leads', 'Meta lead intake', 40),
  ('feature-calling', 'module-calling', 'calling', 'Browser calling', 50),
  ('feature-call-recording', 'module-calling', 'call_recording', 'Call recording', 60),
  ('feature-voicemail', 'module-calling', 'voicemail', 'Voicemail', 70),
  ('feature-sms', 'module-communications', 'sms', 'SMS', 80),
  ('feature-communication-inbox', 'module-communications', 'communication_inbox', 'Communication inbox', 90),
  ('feature-email-sync', 'module-communications', 'email_sync', 'Email synchronization', 100),
  ('feature-internal-chat', 'module-communications', 'internal_chat', 'Internal team chat', 110),
  ('feature-client-management', 'module-case-management', 'client_management', 'Client management', 120),
  ('feature-case-management', 'module-case-management', 'case_management', 'Case management', 130),
  ('feature-documents', 'module-documents-esign', 'documents', 'Documents', 140),
  ('feature-esignatures', 'module-documents-esign', 'esignatures', 'E-signatures', 150),
  ('feature-government-forms', 'module-forms', 'government_forms', 'Government forms', 160),
  ('feature-questionnaires', 'module-forms', 'questionnaires', 'Questionnaires', 170),
  ('feature-workflow-automation', 'module-workflow', 'workflow_automation', 'Workflow automation', 180),
  ('feature-appointments', 'module-scheduling', 'appointments', 'Appointments', 190),
  ('feature-public-booking', 'module-scheduling', 'public_booking', 'Public booking', 200),
  ('feature-waitlists', 'module-scheduling', 'waitlists', 'Waitlists', 210),
  ('feature-outlook-calendar', 'module-scheduling', 'outlook_calendar', 'Outlook calendar', 220),
  ('feature-billing', 'module-billing', 'billing', 'Billing', 230),
  ('feature-online-payments', 'module-billing', 'online_payments', 'Online payments', 240),
  ('feature-payment-schedules', 'module-billing', 'payment_schedules', 'Payment schedules', 250),
  ('feature-cash-ledger', 'module-billing', 'cash_ledger', 'Cash ledger', 260),
  ('feature-custom-ledgers', 'module-billing', 'custom_ledgers', 'Custom ledgers', 270),
  ('feature-quickbooks', 'module-quickbooks', 'quickbooks', 'QuickBooks integration', 280),
  ('feature-client-portal', 'module-client-portal', 'client_portal', 'Client portal', 290),
  ('feature-workload', 'module-team', 'workload_management', 'Workload management', 300),
  ('feature-advanced-permissions', 'module-team', 'advanced_permissions', 'Advanced permissions', 310),
  ('feature-incentives', 'module-performance', 'incentives', 'Incentives', 320),
  ('feature-revenue-contests', 'module-performance', 'revenue_contests', 'Revenue contests', 330),
  ('feature-nova-ai', 'module-nova', 'nova_ai', 'Nova AI', 340),
  ('feature-advanced-audit', 'module-security', 'advanced_audit', 'Advanced audit', 350),
  ('feature-api-access', 'module-integrations', 'api_access', 'API access', 360),
  ('feature-custom-integrations', 'module-integrations', 'custom_integrations', 'Custom integrations', 370);

INSERT INTO "commercial_limits" ("id", "module_id", "key", "name", "unit", "is_metered", "sort_order") VALUES
  ('limit-team-members', 'module-team', 'team_members', 'Staff seats', 'users', false, 10),
  ('limit-storage-gb', 'module-documents-esign', 'storage_gb', 'Storage', 'GB', true, 20),
  ('limit-ai-credits', 'module-nova', 'monthly_ai_credits', 'Monthly AI credits', 'credits', true, 30),
  ('limit-sms-allowance', 'module-communications', 'monthly_sms_allowance', 'Monthly SMS allowance', 'messages', true, 40),
  ('limit-call-minutes', 'module-calling', 'monthly_call_minutes', 'Monthly call minutes', 'minutes', true, 50),
  ('limit-automation-runs', 'module-workflow', 'automation_runs', 'Monthly automation runs', 'runs', true, 60);

INSERT INTO "subscription_plans" ("id", "key", "name", "description", "visibility", "is_legacy", "sort_order") VALUES
  ('plan-solo', 'solo', 'Solo', 'Core CaseDesk for an independent immigration professional.', 'public', false, 10),
  ('plan-firm', 'firm', 'Firm', 'Communication, automation, and integrations for a growing practice.', 'public', false, 20),
  ('plan-scale', 'scale', 'Scale', 'Advanced team, finance, incentives, and audit controls.', 'public', false, 30),
  ('plan-enterprise', 'enterprise', 'Enterprise', 'Custom security, integrations, onboarding, and service terms.', 'public', false, 40),
  ('plan-legacy-full-access', 'legacy_full_access', 'Legacy Full Access', 'Backward-compatible access for workspaces created before commercial enforcement.', 'internal', true, 999);

INSERT INTO "subscription_plan_prices" ("id", "plan_id", "currency", "billing_interval", "amount") VALUES
  ('price-solo-monthly-cad', 'plan-solo', 'CAD', 'monthly', 109),
  ('price-solo-annual-cad', 'plan-solo', 'CAD', 'annual', 1068),
  ('price-firm-monthly-cad', 'plan-firm', 'CAD', 'monthly', 299),
  ('price-firm-annual-cad', 'plan-firm', 'CAD', 'annual', 2988),
  ('price-scale-monthly-cad', 'plan-scale', 'CAD', 'monthly', 529),
  ('price-scale-annual-cad', 'plan-scale', 'CAD', 'annual', 5388);

INSERT INTO "plan_features" ("id", "plan_id", "feature_id", "enabled")
SELECT 'plan-feature-legacy-' || "key", 'plan-legacy-full-access', "id", true FROM "commercial_features";

INSERT INTO "plan_features" ("id", "plan_id", "feature_id", "enabled")
SELECT 'plan-feature-enterprise-' || "key", 'plan-enterprise', "id", true FROM "commercial_features";

INSERT INTO "plan_features" ("id", "plan_id", "feature_id", "enabled")
SELECT 'plan-feature-solo-' || "key", 'plan-solo', "id", true FROM "commercial_features"
WHERE "key" IN ('core_crm', 'leads', 'client_management', 'case_management', 'documents', 'government_forms', 'questionnaires', 'esignatures', 'appointments', 'billing', 'client_portal', 'nova_ai');

INSERT INTO "plan_features" ("id", "plan_id", "feature_id", "enabled")
SELECT 'plan-feature-firm-' || "key", 'plan-firm', "id", true FROM "commercial_features"
WHERE "key" IN ('core_crm', 'leads', 'lead_automation', 'meta_leads', 'calling', 'call_recording', 'voicemail', 'sms', 'communication_inbox', 'email_sync', 'internal_chat', 'client_management', 'case_management', 'documents', 'esignatures', 'government_forms', 'questionnaires', 'workflow_automation', 'appointments', 'public_booking', 'waitlists', 'outlook_calendar', 'billing', 'online_payments', 'payment_schedules', 'quickbooks', 'client_portal', 'workload_management', 'nova_ai');

INSERT INTO "plan_features" ("id", "plan_id", "feature_id", "enabled")
SELECT 'plan-feature-scale-' || "key", 'plan-scale', "id", true FROM "commercial_features"
WHERE "key" NOT IN ('api_access', 'custom_integrations');

INSERT INTO "plan_limits" ("id", "plan_id", "limit_id", "value", "is_unlimited") VALUES
  ('plan-limit-solo-seats', 'plan-solo', 'limit-team-members', 1, false),
  ('plan-limit-solo-storage', 'plan-solo', 'limit-storage-gb', 10, false),
  ('plan-limit-solo-ai', 'plan-solo', 'limit-ai-credits', 1000, false),
  ('plan-limit-solo-sms', 'plan-solo', 'limit-sms-allowance', 0, false),
  ('plan-limit-solo-calls', 'plan-solo', 'limit-call-minutes', 0, false),
  ('plan-limit-solo-automation', 'plan-solo', 'limit-automation-runs', 1000, false),
  ('plan-limit-firm-seats', 'plan-firm', 'limit-team-members', 5, false),
  ('plan-limit-firm-storage', 'plan-firm', 'limit-storage-gb', 50, false),
  ('plan-limit-firm-ai', 'plan-firm', 'limit-ai-credits', 5000, false),
  ('plan-limit-firm-sms', 'plan-firm', 'limit-sms-allowance', 1000, false),
  ('plan-limit-firm-calls', 'plan-firm', 'limit-call-minutes', 500, false),
  ('plan-limit-firm-automation', 'plan-firm', 'limit-automation-runs', 10000, false),
  ('plan-limit-scale-seats', 'plan-scale', 'limit-team-members', 10, false),
  ('plan-limit-scale-storage', 'plan-scale', 'limit-storage-gb', 100, false),
  ('plan-limit-scale-ai', 'plan-scale', 'limit-ai-credits', 15000, false),
  ('plan-limit-scale-sms', 'plan-scale', 'limit-sms-allowance', 5000, false),
  ('plan-limit-scale-calls', 'plan-scale', 'limit-call-minutes', 2500, false),
  ('plan-limit-scale-automation', 'plan-scale', 'limit-automation-runs', 50000, false);

INSERT INTO "plan_limits" ("id", "plan_id", "limit_id", "value", "is_unlimited")
SELECT 'plan-limit-legacy-' || "key", 'plan-legacy-full-access', "id", NULL, true FROM "commercial_limits";

INSERT INTO "plan_limits" ("id", "plan_id", "limit_id", "value", "is_unlimited")
SELECT 'plan-limit-enterprise-' || "key", 'plan-enterprise', "id", NULL, true FROM "commercial_limits";

INSERT INTO "workspace_subscriptions" ("id", "agency_id", "plan_id", "status", "billing_interval", "billing_provider", "currency")
SELECT gen_random_uuid()::text, "id", 'plan-legacy-full-access', 'active', 'custom', 'manual', COALESCE("default_currency", 'CAD')
FROM "agencies"
WHERE COALESCE("slug", '') <> 'casedesk-developer'
ON CONFLICT ("agency_id") DO NOTHING;
