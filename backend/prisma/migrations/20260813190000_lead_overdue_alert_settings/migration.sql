ALTER TABLE "lead_settings"
  ADD COLUMN IF NOT EXISTS "overdue_alert_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "overdue_alert_admin_threshold" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "overdue_alert_last_run_at" TIMESTAMP(3);
