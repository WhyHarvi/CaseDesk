ALTER TABLE "subscription_plans"
ADD COLUMN "trial_days" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "subscription_plans"
ADD CONSTRAINT "subscription_plans_trial_days_check"
CHECK ("trial_days" >= 0 AND "trial_days" <= 365);

INSERT INTO "subscription_plans" (
  "id",
  "key",
  "name",
  "description",
  "visibility",
  "is_active",
  "is_legacy",
  "trial_days",
  "sort_order"
) VALUES (
  'plan-demo',
  'demo',
  'Demo',
  'Seven days of CaseDesk basics for evaluating the core practice workflow.',
  'public',
  true,
  false,
  7,
  5
);

INSERT INTO "plan_features" ("id", "plan_id", "feature_id", "enabled")
SELECT 'plan-feature-demo-' || "key", 'plan-demo', "id", true
FROM "commercial_features"
WHERE "key" IN (
  'core_crm',
  'leads',
  'client_management',
  'case_management',
  'documents',
  'government_forms',
  'questionnaires',
  'esignatures',
  'appointments',
  'billing',
  'client_portal',
  'nova_ai'
);

INSERT INTO "plan_limits" ("id", "plan_id", "limit_id", "value", "is_unlimited")
SELECT
  'plan-limit-demo-' || limits."key",
  'plan-demo',
  solo."limit_id",
  solo."value",
  solo."is_unlimited"
FROM "plan_limits" solo
JOIN "commercial_limits" limits ON limits."id" = solo."limit_id"
WHERE solo."plan_id" = 'plan-solo';
