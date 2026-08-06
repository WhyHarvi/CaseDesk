-- AlterEnum: audit-trail activity type for a manual lead priority change.
ALTER TYPE "LeadActivityType" ADD VALUE IF NOT EXISTS 'PRIORITY_CHANGED';
