ALTER TABLE "incentive_plan_milestone_rules"
  ADD COLUMN "payout_percent" DECIMAL(5,2) NOT NULL DEFAULT 100;

ALTER TABLE "incentive_milestone_evaluations"
  ADD COLUMN "payout_percent_snapshot" DECIMAL(5,2) NOT NULL DEFAULT 100;

ALTER TABLE "incentive_plan_milestone_rules"
  ADD CONSTRAINT "incentive_plan_milestone_rules_payout_percent_check"
  CHECK ("payout_percent" > 0 AND "payout_percent" <= 100);
