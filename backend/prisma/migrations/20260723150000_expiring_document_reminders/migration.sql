CREATE TABLE "expiring_document_reminder_policies" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "document_key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "notify_client" BOOLEAN NOT NULL DEFAULT true,
  "lead_days" INTEGER NOT NULL DEFAULT 183,
  "cadence_days" INTEGER NOT NULL DEFAULT 30,
  "max_reminders" INTEGER NOT NULL DEFAULT 1,
  "email_enabled" BOOLEAN NOT NULL DEFAULT true,
  "sms_enabled" BOOLEAN NOT NULL DEFAULT false,
  "subject_template" TEXT NOT NULL,
  "message_template" TEXT NOT NULL,
  "sms_template" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expiring_document_reminder_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "expiring_document_reminder_deliveries" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "policy_id" TEXT NOT NULL,
  "target_key" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "case_id" TEXT,
  "sequence" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "email_sent_at" TIMESTAMP(3),
  "sms_sent_at" TIMESTAMP(3),
  "portal_sent_at" TIMESTAMP(3),
  "staff_sent_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "next_attempt_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "expiring_document_reminder_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "expiring_document_reminder_policies_agency_id_document_key_key" ON "expiring_document_reminder_policies"("agency_id", "document_key");
CREATE INDEX "expiring_document_reminder_policies_agency_id_enabled_idx" ON "expiring_document_reminder_policies"("agency_id", "enabled");
CREATE UNIQUE INDEX "expiring_document_reminder_deliveries_policy_id_target_key_sequence_key" ON "expiring_document_reminder_deliveries"("policy_id", "target_key", "sequence");
CREATE INDEX "expiring_document_reminder_deliveries_agency_id_status_next_attempt_at_idx" ON "expiring_document_reminder_deliveries"("agency_id", "status", "next_attempt_at");
CREATE INDEX "expiring_document_reminder_deliveries_policy_id_target_key_sent_at_idx" ON "expiring_document_reminder_deliveries"("policy_id", "target_key", "sent_at");

ALTER TABLE "expiring_document_reminder_policies"
  ADD CONSTRAINT "expiring_document_reminder_policies_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "expiring_document_reminder_deliveries"
  ADD CONSTRAINT "expiring_document_reminder_deliveries_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "expiring_document_reminder_deliveries"
  ADD CONSTRAINT "expiring_document_reminder_deliveries_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "expiring_document_reminder_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "expiring_document_reminder_policies"
  ("id", "agency_id", "document_key", "enabled", "subject_template", "message_template", "sms_template", "updated_at")
SELECT
  gen_random_uuid()::text,
  agency."id",
  document."key",
  false,
  'Upcoming expiration — {{documentName}}',
  E'Hello {{clientName}},\n\nYour {{documentName}} is scheduled to expire on {{expirationDate}} ({{daysRemaining}} days from now).\n\nPlease contact your case team if you need help renewing or replacing it: {{portalLink}}\n\n{{agencyName}}',
  '{{agencyName}}: Your {{documentName}} expires {{expirationDate}}. Contact your case team: {{portalLink}}',
  CURRENT_TIMESTAMP
FROM "agencies" agency
CROSS JOIN (
  VALUES
    ('biometrics'), ('copr'), ('eta'), ('lmia'), ('national-id'),
    ('nomination-endorsement'), ('passport'), ('pr-card'), ('prtd'), ('pgwp'),
    ('rpcd'), ('rpid'), ('study-permit'), ('study-visa'), ('trp'), ('us-pr-card'),
    ('vos'), ('visitor-record'), ('visitor-visa'), ('work-permit'), ('worker-visa')
) AS document("key")
ON CONFLICT ("agency_id", "document_key") DO NOTHING;
