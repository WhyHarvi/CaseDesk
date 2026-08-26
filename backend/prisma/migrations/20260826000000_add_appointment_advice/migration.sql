-- CreateEnum
CREATE TYPE "AppointmentAdviceOutcome" AS ENUM ('PENDING', 'PROCEEDING', 'CONSIDERING', 'DECLINED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LeadActivityType" ADD VALUE 'ADVICE_RECORDED';
ALTER TYPE "LeadActivityType" ADD VALUE 'ADVICE_OUTCOME_RECORDED';

-- CreateTable
CREATE TABLE "appointment_advice" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "lead_id" TEXT,
    "client_id" TEXT,
    "consultant_user_id" TEXT NOT NULL,
    "assigned_user_id" TEXT NOT NULL,
    "categories" TEXT[],
    "advice_text" TEXT NOT NULL,
    "follow_up_date" TIMESTAMP(3) NOT NULL,
    "follow_up_id" TEXT,
    "outcome" "AppointmentAdviceOutcome" NOT NULL DEFAULT 'PENDING',
    "outcome_recorded_at" TIMESTAMP(3),
    "outcome_recorded_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_advice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "appointment_advice_appointment_id_key" ON "appointment_advice"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_advice_follow_up_id_key" ON "appointment_advice"("follow_up_id");

-- CreateIndex
CREATE INDEX "appointment_advice_agency_id_idx" ON "appointment_advice"("agency_id");

-- CreateIndex
CREATE INDEX "appointment_advice_lead_id_idx" ON "appointment_advice"("lead_id");

-- CreateIndex
CREATE INDEX "appointment_advice_assigned_user_id_idx" ON "appointment_advice"("assigned_user_id");

-- AddForeignKey
ALTER TABLE "appointment_advice" ADD CONSTRAINT "appointment_advice_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_advice" ADD CONSTRAINT "appointment_advice_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_advice" ADD CONSTRAINT "appointment_advice_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_advice" ADD CONSTRAINT "appointment_advice_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_advice" ADD CONSTRAINT "appointment_advice_consultant_user_id_fkey" FOREIGN KEY ("consultant_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_advice" ADD CONSTRAINT "appointment_advice_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_advice" ADD CONSTRAINT "appointment_advice_outcome_recorded_by_id_fkey" FOREIGN KEY ("outcome_recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_advice" ADD CONSTRAINT "appointment_advice_follow_up_id_fkey" FOREIGN KEY ("follow_up_id") REFERENCES "lead_follow_ups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

