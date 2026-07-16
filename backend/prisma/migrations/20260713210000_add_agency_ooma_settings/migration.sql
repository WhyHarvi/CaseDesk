CREATE TABLE "agency_ooma_settings" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "api_base_url" TEXT NOT NULL,
  "api_key_encrypted" TEXT NOT NULL,
  "from_number" TEXT NOT NULL,
  "sms_send_path" TEXT,
  "call_start_path" TEXT,
  "auth_header" TEXT NOT NULL DEFAULT 'authorization',
  "auth_prefix" TEXT NOT NULL DEFAULT 'Bearer',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sms_enabled" BOOLEAN NOT NULL DEFAULT true,
  "calls_enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_sms_tested_at" TIMESTAMP(3),
  "last_sms_test_status" TEXT,
  "last_sms_test_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agency_ooma_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agency_ooma_settings_agency_id_key" ON "agency_ooma_settings"("agency_id");
CREATE INDEX "agency_ooma_settings_agency_id_idx" ON "agency_ooma_settings"("agency_id");

ALTER TABLE "agency_ooma_settings"
  ADD CONSTRAINT "agency_ooma_settings_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
