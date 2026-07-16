CREATE TABLE "agency_mail_settings" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'Custom',
  "display_name" TEXT,
  "email_address" TEXT NOT NULL,
  "smtp_host" TEXT NOT NULL,
  "smtp_port" INTEGER NOT NULL,
  "smtp_secure" BOOLEAN NOT NULL DEFAULT true,
  "smtp_username" TEXT NOT NULL,
  "smtp_password_encrypted" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_tested_at" TIMESTAMP(3),
  "last_test_status" TEXT,
  "last_test_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agency_mail_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agency_mail_settings_agency_id_key" ON "agency_mail_settings"("agency_id");
CREATE INDEX "agency_mail_settings_agency_id_idx" ON "agency_mail_settings"("agency_id");

ALTER TABLE "agency_mail_settings"
  ADD CONSTRAINT "agency_mail_settings_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
