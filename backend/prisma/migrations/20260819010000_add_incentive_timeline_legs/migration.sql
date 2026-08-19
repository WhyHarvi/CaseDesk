-- CreateTable
CREATE TABLE "incentive_plan_timeline_legs" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "from_checkpoint_type" TEXT NOT NULL,
    "from_checkpoint_value" TEXT,
    "to_checkpoint_type" TEXT NOT NULL,
    "to_checkpoint_value" TEXT,
    "base_bonus_amount" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incentive_plan_timeline_legs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_plan_timeline_leg_tiers" (
    "id" TEXT NOT NULL,
    "leg_id" TEXT NOT NULL,
    "threshold_days" DECIMAL(6,2) NOT NULL,
    "multiplier_percent" DECIMAL(5,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incentive_plan_timeline_leg_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incentive_plan_timeline_legs_plan_id_idx" ON "incentive_plan_timeline_legs"("plan_id");

-- CreateIndex
CREATE UNIQUE INDEX "incentive_plan_timeline_leg_tiers_leg_id_threshold_days_key" ON "incentive_plan_timeline_leg_tiers"("leg_id", "threshold_days");

-- AddForeignKey
ALTER TABLE "incentive_plan_timeline_legs" ADD CONSTRAINT "incentive_plan_timeline_legs_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "incentive_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_plan_timeline_leg_tiers" ADD CONSTRAINT "incentive_plan_timeline_leg_tiers_leg_id_fkey" FOREIGN KEY ("leg_id") REFERENCES "incentive_plan_timeline_legs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
