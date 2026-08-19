-- AlterTable: a TIMELINE_BONUS ledger entry has no invoice at all.
ALTER TABLE "incentive_ledger_entries" ALTER COLUMN "case_invoice_id" DROP NOT NULL;
ALTER TABLE "incentive_ledger_entries" ADD COLUMN "timeline_leg_evaluation_id" TEXT;

-- CreateTable
CREATE TABLE "incentive_timeline_leg_evaluations" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "leg_id" TEXT NOT NULL,
    "leg_name_snapshot" TEXT NOT NULL,
    "incentive_plan_id" TEXT NOT NULL,
    "from_checkpoint_at" TIMESTAMP(3) NOT NULL,
    "to_checkpoint_at" TIMESTAMP(3) NOT NULL,
    "elapsed_minutes" INTEGER NOT NULL,
    "matched_tier_id" TEXT,
    "multiplier_percent" DECIMAL(5,2),
    "base_bonus_amount" DECIMAL(10,2) NOT NULL,
    "credited_total" DECIMAL(10,2) NOT NULL,
    "outcome" TEXT NOT NULL,
    "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incentive_timeline_leg_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "incentive_timeline_leg_evaluations_case_id_leg_id_key" ON "incentive_timeline_leg_evaluations"("case_id", "leg_id");

-- CreateIndex
CREATE INDEX "incentive_timeline_leg_evaluations_agency_id_case_id_idx" ON "incentive_timeline_leg_evaluations"("agency_id", "case_id");

-- AddForeignKey
ALTER TABLE "incentive_timeline_leg_evaluations" ADD CONSTRAINT "incentive_timeline_leg_evaluations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_timeline_leg_evaluations" ADD CONSTRAINT "incentive_timeline_leg_evaluations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_timeline_leg_evaluations" ADD CONSTRAINT "incentive_timeline_leg_evaluations_incentive_plan_id_fkey" FOREIGN KEY ("incentive_plan_id") REFERENCES "incentive_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_ledger_entries" ADD CONSTRAINT "incentive_ledger_entries_timeline_leg_evaluation_id_fkey" FOREIGN KEY ("timeline_leg_evaluation_id") REFERENCES "incentive_timeline_leg_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
