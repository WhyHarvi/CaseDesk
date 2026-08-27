-- Ooma is no longer a supported communication provider. Twilio call history
-- remains in the legacy ooma_call_sessions/ooma_call_events tables so existing
-- history is preserved.
DROP TABLE IF EXISTS "agency_ooma_settings";
ALTER TABLE "ooma_call_sessions" ALTER COLUMN "provider" SET DEFAULT 'TWILIO';
