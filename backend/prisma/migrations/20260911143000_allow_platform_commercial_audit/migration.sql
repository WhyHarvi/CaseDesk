-- Catalog changes are platform-wide, so they do not belong to a customer agency.
-- Workspace subscription and override changes continue to require agency_id.
ALTER TABLE "subscription_audit_logs"
ALTER COLUMN "agency_id" DROP NOT NULL;
