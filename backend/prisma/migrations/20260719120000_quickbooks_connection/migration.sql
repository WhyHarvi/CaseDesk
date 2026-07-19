CREATE TABLE "agency_quickbooks_settings" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "environment" TEXT NOT NULL DEFAULT 'production',
  "realm_id" TEXT NOT NULL,
  "company_name" TEXT,
  "access_token_encrypted" TEXT NOT NULL,
  "refresh_token_encrypted" TEXT NOT NULL,
  "access_token_expires_at" TIMESTAMP(3) NOT NULL,
  "refresh_token_expires_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'connected',
  "last_error" TEXT,
  "connected_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agency_quickbooks_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "agency_quickbooks_settings_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agency_quickbooks_settings_agency_id_key" ON "agency_quickbooks_settings"("agency_id");

ALTER TABLE "agency_quickbooks_settings" ENABLE ROW LEVEL SECURITY;
CREATE POLICY quickbooks_settings_admin ON "agency_quickbooks_settings" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
