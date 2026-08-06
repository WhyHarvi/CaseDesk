-- AlterEnum: audit-trail activity type for a lead moving from the Import
-- Review segment back into the standard working pipeline.
ALTER TYPE "LeadActivityType" ADD VALUE IF NOT EXISTS 'LEAD_PROMOTED_TO_PIPELINE';
