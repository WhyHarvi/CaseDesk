-- AlterTable
ALTER TABLE "appointment_advice" ADD COLUMN     "additional_assigned_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
