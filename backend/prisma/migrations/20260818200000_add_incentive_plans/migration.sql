-- CreateTable
CREATE TABLE "incentive_plans" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "case_type" TEXT,
    "formula_type" TEXT NOT NULL,
    "flat_amount" DECIMAL(10,2),
    "percent_rate" DECIMAL(5,2),
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT,
    "activated_at" TIMESTAMP(3),
    "deactivated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incentive_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_plan_tiers" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "min_cumulative_amount" DECIMAL(10,2) NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incentive_plan_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incentive_plan_role_shares" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "attribution_kind" TEXT NOT NULL,
    "case_role_id" TEXT,
    "share_percent" DECIMAL(5,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incentive_plan_role_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incentive_plans_agency_id_case_type_is_active_idx" ON "incentive_plans"("agency_id", "case_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "incentive_plan_tiers_plan_id_min_cumulative_amount_key" ON "incentive_plan_tiers"("plan_id", "min_cumulative_amount");

-- AddForeignKey
ALTER TABLE "incentive_plans" ADD CONSTRAINT "incentive_plans_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_plans" ADD CONSTRAINT "incentive_plans_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_plan_tiers" ADD CONSTRAINT "incentive_plan_tiers_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "incentive_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_plan_role_shares" ADD CONSTRAINT "incentive_plan_role_shares_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "incentive_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incentive_plan_role_shares" ADD CONSTRAINT "incentive_plan_role_shares_case_role_id_fkey" FOREIGN KEY ("case_role_id") REFERENCES "agency_case_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce "exactly one active plan per (agency, case type) scope" — not
-- expressible via Prisma's @@unique, which can't add a WHERE clause. NULL
-- case_type (the agency-wide fallback plan) is coalesced to '' so Postgres
-- treats it as a normal, comparable scope value instead of NULL <> NULL
-- always being "distinct".
CREATE UNIQUE INDEX "incentive_plans_one_active_per_scope"
    ON "incentive_plans" ("agency_id", COALESCE("case_type", ''))
    WHERE "is_active" = true;
