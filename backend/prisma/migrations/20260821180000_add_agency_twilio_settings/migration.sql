CREATE TABLE "agency_twilio_settings" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "account_sid" TEXT,
  "auth_token_encrypted" TEXT,
  "from_number" TEXT,
  "messaging_service_sid" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "sms_enabled" BOOLEAN NOT NULL DEFAULT true,
  "last_verified_at" TIMESTAMP(3),
  "last_verified_status" TEXT,
  "last_verified_message" TEXT,
  "last_sms_tested_at" TIMESTAMP(3),
  "last_sms_test_status" TEXT,
  "last_sms_test_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "agency_twilio_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agency_twilio_settings_agency_id_key" ON "agency_twilio_settings"("agency_id");
CREATE INDEX "agency_twilio_settings_agency_id_idx" ON "agency_twilio_settings"("agency_id");

ALTER TABLE "agency_twilio_settings"
  ADD CONSTRAINT "agency_twilio_settings_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
