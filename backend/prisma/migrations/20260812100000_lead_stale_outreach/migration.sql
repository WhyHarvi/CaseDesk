ALTER TABLE "lead_settings"
  ADD COLUMN "stale_outreach_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stale_outreach_days" INTEGER NOT NULL DEFAULT 14,
  ADD COLUMN "stale_outreach_email_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "stale_outreach_sms_enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "stale_outreach_last_run_at" TIMESTAMP(3);
