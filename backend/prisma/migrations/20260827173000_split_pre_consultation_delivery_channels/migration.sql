ALTER TABLE "booking_settings"
  ADD COLUMN "pre_consultation_email_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pre_consultation_sms_enabled" BOOLEAN NOT NULL DEFAULT false;

UPDATE "booking_settings"
SET
  "pre_consultation_email_enabled" = "pre_consultation_intake_enabled",
  "pre_consultation_sms_enabled" = "pre_consultation_intake_enabled";
