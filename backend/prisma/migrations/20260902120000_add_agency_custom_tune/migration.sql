-- An agency's own uploaded audio tune, stored alongside its call greetings.
ALTER TABLE "agency_twilio_settings"
  ADD COLUMN "custom_tune_storage_key" TEXT,
  ADD COLUMN "custom_tune_mime_type" TEXT,
  ADD COLUMN "custom_tune_filename" TEXT,
  ADD COLUMN "custom_tune_uploaded_at" TIMESTAMP(3);
