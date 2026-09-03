ALTER TABLE "incentive_ledger_entries"
  ADD COLUMN "plan_name_snapshot" TEXT,
  ADD COLUMN "plan_version_snapshot" INTEGER,
  ADD COLUMN "formula_type_snapshot" TEXT,
  ADD COLUMN "calculation_snapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "incentive_cycle_id" TEXT,
  ADD COLUMN "incentive_period_id" TEXT;
ALTER TABLE "incentive_ledger_entries" ALTER COLUMN "case_id" DROP NOT NULL;
ALTER TABLE "incentive_ledger_entries" ALTER COLUMN "incentive_plan_id" DROP NOT NULL;

ALTER TABLE "cases" ADD COLUMN "revenue_owner_id" TEXT;
UPDATE "cases" SET "revenue_owner_id" = "assigned_user_id" WHERE "revenue_owner_id" IS NULL;
ALTER TABLE "cases" ADD CONSTRAINT "cases_revenue_owner_id_fkey" FOREIGN KEY ("revenue_owner_id") REFERENCES "users"("id") ON DELETE SET NULL;
CREATE INDEX "cases_agency_id_revenue_owner_id_idx" ON "cases"("agency_id", "revenue_owner_id");
ALTER TABLE "agency_fee_categories" ADD COLUMN "counts_toward_revenue" BOOLEAN NOT NULL DEFAULT false;
UPDATE "agency_fee_categories" SET "counts_toward_revenue" = true WHERE "code" = 'fees';

CREATE INDEX "incentive_ledger_entries_agency_id_incentive_cycle_id_idx"
  ON "incentive_ledger_entries"("agency_id", "incentive_cycle_id");
CREATE INDEX "incentive_ledger_entries_agency_id_incentive_period_id_idx"
  ON "incentive_ledger_entries"("agency_id", "incentive_period_id");

CREATE TABLE "incentive_plan_milestone_rules" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "plan_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "flat_amount" DECIMAL(10,2) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "incentive_plan_milestone_rules_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incentive_plan_milestone_rules_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "incentive_plans"("id") ON DELETE CASCADE,
  CONSTRAINT "incentive_plan_milestone_rules_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "incentive_plan_milestone_rules_plan_id_event_type_key" ON "incentive_plan_milestone_rules"("plan_id", "event_type");
CREATE INDEX "incentive_plan_milestone_rules_agency_id_plan_id_idx" ON "incentive_plan_milestone_rules"("agency_id", "plan_id");

CREATE TABLE "incentive_cycles" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "cycle_type" TEXT NOT NULL DEFAULT 'ORIGINAL',
  "incentive_eligible" BOOLEAN NOT NULL DEFAULT true,
  "eligibility_reason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closed_at" TIMESTAMP(3),
  CONSTRAINT "incentive_cycles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incentive_cycles_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "incentive_cycles_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE,
  CONSTRAINT "incentive_cycles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "incentive_cycles_case_id_sequence_key" ON "incentive_cycles"("case_id", "sequence");
CREATE INDEX "incentive_cycles_agency_id_case_id_status_idx" ON "incentive_cycles"("agency_id", "case_id", "status");

CREATE TABLE "incentive_milestone_evaluations" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "incentive_cycle_id" TEXT NOT NULL,
  "incentive_plan_id" TEXT NOT NULL,
  "milestone_rule_id" TEXT NOT NULL,
  "event_type" TEXT NOT NULL,
  "event_name_snapshot" TEXT NOT NULL,
  "amount_snapshot" DECIMAL(10,2) NOT NULL,
  "trigger_source" TEXT NOT NULL,
  "trigger_ref" TEXT NOT NULL,
  "occurred_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "incentive_milestone_evaluations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incentive_milestone_evaluations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "incentive_milestone_evaluations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE,
  CONSTRAINT "incentive_milestone_evaluations_cycle_id_fkey" FOREIGN KEY ("incentive_cycle_id") REFERENCES "incentive_cycles"("id") ON DELETE RESTRICT,
  CONSTRAINT "incentive_milestone_evaluations_plan_id_fkey" FOREIGN KEY ("incentive_plan_id") REFERENCES "incentive_plans"("id") ON DELETE RESTRICT,
  CONSTRAINT "incentive_milestone_evaluations_rule_id_fkey" FOREIGN KEY ("milestone_rule_id") REFERENCES "incentive_plan_milestone_rules"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "incentive_milestone_evaluations_cycle_event_key" ON "incentive_milestone_evaluations"("incentive_cycle_id", "event_type");
CREATE UNIQUE INDEX "incentive_milestone_evaluations_trigger_key" ON "incentive_milestone_evaluations"("agency_id", "trigger_source", "trigger_ref", "event_type");
CREATE INDEX "incentive_milestone_evaluations_agency_case_occurred_idx" ON "incentive_milestone_evaluations"("agency_id", "case_id", "occurred_at");

CREATE TABLE "incentive_periods" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "closed_by_id" TEXT,
  "closed_reason" TEXT,
  "closed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "incentive_periods_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incentive_periods_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "incentive_periods_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "incentive_periods_agency_id_starts_at_key" ON "incentive_periods"("agency_id", "starts_at");
CREATE INDEX "incentive_periods_agency_id_status_starts_at_idx" ON "incentive_periods"("agency_id", "status", "starts_at");

CREATE TABLE "incentive_revenue_credits" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "incentive_period_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "case_invoice_id" TEXT NOT NULL,
  "revenue_owner_id" TEXT NOT NULL,
  "revenue_owner_snapshot" TEXT NOT NULL,
  "revenue_category" TEXT NOT NULL,
  "source_amount" DECIMAL(10,2) NOT NULL,
  "net_amount" DECIMAL(10,2) NOT NULL,
  "trigger_source" TEXT NOT NULL,
  "trigger_ref" TEXT NOT NULL,
  "reverses_credit_id" TEXT,
  "collected_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "incentive_revenue_credits_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incentive_revenue_credits_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "incentive_revenue_credits_period_id_fkey" FOREIGN KEY ("incentive_period_id") REFERENCES "incentive_periods"("id") ON DELETE RESTRICT,
  CONSTRAINT "incentive_revenue_credits_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE,
  CONSTRAINT "incentive_revenue_credits_invoice_id_fkey" FOREIGN KEY ("case_invoice_id") REFERENCES "case_invoices"("id") ON DELETE CASCADE,
  CONSTRAINT "incentive_revenue_credits_owner_id_fkey" FOREIGN KEY ("revenue_owner_id") REFERENCES "users"("id") ON DELETE RESTRICT,
  CONSTRAINT "incentive_revenue_credits_reversal_id_fkey" FOREIGN KEY ("reverses_credit_id") REFERENCES "incentive_revenue_credits"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "incentive_revenue_credits_trigger_key" ON "incentive_revenue_credits"("agency_id", "trigger_source", "trigger_ref");
CREATE INDEX "incentive_revenue_credits_period_owner_idx" ON "incentive_revenue_credits"("agency_id", "incentive_period_id", "revenue_owner_id");
CREATE INDEX "incentive_revenue_credits_invoice_idx" ON "incentive_revenue_credits"("agency_id", "case_invoice_id");
CREATE INDEX "incentive_revenue_credits_reversal_idx" ON "incentive_revenue_credits"("reverses_credit_id");

CREATE TABLE "incentive_contests" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "incentive_period_id" TEXT NOT NULL,
  "prize_type" TEXT NOT NULL,
  "prize_value" DECIMAL(10,2) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "ranking_snapshot" JSONB NOT NULL DEFAULT '[]',
  "winner_snapshot" JSONB NOT NULL DEFAULT '[]',
  "finalized_by_id" TEXT,
  "finalized_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "incentive_contests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "incentive_contests_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE,
  CONSTRAINT "incentive_contests_period_id_fkey" FOREIGN KEY ("incentive_period_id") REFERENCES "incentive_periods"("id") ON DELETE RESTRICT,
  CONSTRAINT "incentive_contests_finalized_by_id_fkey" FOREIGN KEY ("finalized_by_id") REFERENCES "users"("id") ON DELETE SET NULL
);
CREATE UNIQUE INDEX "incentive_contests_incentive_period_id_key" ON "incentive_contests"("incentive_period_id");
CREATE INDEX "incentive_contests_agency_id_status_idx" ON "incentive_contests"("agency_id", "status");

ALTER TABLE "incentive_ledger_entries"
  ADD CONSTRAINT "incentive_ledger_entries_cycle_id_fkey" FOREIGN KEY ("incentive_cycle_id") REFERENCES "incentive_cycles"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "incentive_ledger_entries_period_id_fkey" FOREIGN KEY ("incentive_period_id") REFERENCES "incentive_periods"("id") ON DELETE RESTRICT;
