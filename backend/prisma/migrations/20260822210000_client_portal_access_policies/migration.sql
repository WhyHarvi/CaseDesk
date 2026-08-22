CREATE TYPE "PortalPolicyScope" AS ENUM ('AGENCY', 'CASE', 'CLIENT_USER');
CREATE TYPE "PortalPolicyStatus" AS ENUM ('ACTIVE', 'RESTRICTED', 'SUSPENDED');

CREATE TABLE "portal_access_policies" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "scope" "PortalPolicyScope" NOT NULL,
  "scope_id" TEXT NOT NULL,
  "preset" TEXT NOT NULL DEFAULT 'STANDARD',
  "status" "PortalPolicyStatus" NOT NULL DEFAULT 'ACTIVE',
  "permissions" JSONB NOT NULL DEFAULT '{}',
  "vetoes" JSONB NOT NULL DEFAULT '{}',
  "valid_from" TIMESTAMP(3),
  "valid_until" TIMESTAMP(3),
  "updated_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "portal_access_policies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "portal_access_policies_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "portal_access_policies_agency_id_scope_scope_id_key" ON "portal_access_policies"("agency_id", "scope", "scope_id");
CREATE INDEX "portal_access_policies_agency_id_scope_idx" ON "portal_access_policies"("agency_id", "scope");
CREATE INDEX "portal_access_policies_agency_id_valid_until_idx" ON "portal_access_policies"("agency_id", "valid_until");

ALTER TABLE "portal_access_policies" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "portal_access_policies_admin" ON "portal_access_policies" FOR ALL TO authenticated
USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
