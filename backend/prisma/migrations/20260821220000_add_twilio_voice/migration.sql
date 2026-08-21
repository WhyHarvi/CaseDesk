-- Twilio Voice (browser softphone): API Key for Access Tokens, voice toggles,
-- and the provisioned TwiML Application SID + number.
ALTER TABLE "agency_twilio_settings"
  ADD COLUMN IF NOT EXISTS "api_key_sid" TEXT,
  ADD COLUMN IF NOT EXISTS "api_key_secret_encrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "calls_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "voice_number" TEXT,
  ADD COLUMN IF NOT EXISTS "twiml_app_sid" TEXT,
  ADD COLUMN IF NOT EXISTS "last_call_tested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_call_test_status" TEXT,
  ADD COLUMN IF NOT EXISTS "last_call_test_message" TEXT;

-- Which provider produced a call session — legacy Ooma (Zapier webhooks) or
-- Twilio (softphone status callbacks / API sync). Both share one inbox.
ALTER TABLE "ooma_call_sessions"
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'OOMA';
CREATE INDEX IF NOT EXISTS "ooma_call_sessions_agency_id_provider_last_event_at_idx"
  ON "ooma_call_sessions"("agency_id", "provider", "last_event_at" DESC);
