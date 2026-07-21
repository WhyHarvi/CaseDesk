BEGIN;

ALTER TABLE "agency_ooma_settings"
  ADD COLUMN IF NOT EXISTS "zapier_outbound_webhook_encrypted" TEXT,
  ADD COLUMN IF NOT EXISTS "last_zapier_outbound_tested_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_zapier_outbound_test_status" TEXT,
  ADD COLUMN IF NOT EXISTS "last_zapier_outbound_test_message" TEXT;

COMMIT;
