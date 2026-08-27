-- AlterTable
ALTER TABLE "cases" ADD COLUMN     "additional_assigned_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "opened_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "case_easy_import_cases" ADD COLUMN     "resolved_additional_assignee_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
