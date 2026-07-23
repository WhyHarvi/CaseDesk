CREATE TYPE "AutomatedReminderKind" AS ENUM ('Invoice', 'Document', 'Agreement', 'Questionnaire');

CREATE TABLE "automated_reminder_policies" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "kind" "AutomatedReminderKind" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "cadence_days" INTEGER NOT NULL DEFAULT 7,
  "max_reminders" INTEGER NOT NULL DEFAULT 3,
  "default_due_days" INTEGER NOT NULL DEFAULT 30,
  "email_enabled" BOOLEAN NOT NULL DEFAULT true,
  "sms_enabled" BOOLEAN NOT NULL DEFAULT false,
  "subject_template" TEXT NOT NULL,
  "message_template" TEXT NOT NULL,
  "sms_template" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "automated_reminder_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "automated_reminder_deliveries" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "policy_id" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "effective_due_at" TIMESTAMP(3) NOT NULL,
  "email_sent_at" TIMESTAMP(3),
  "sms_sent_at" TIMESTAMP(3),
  "portal_sent_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "next_attempt_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "automated_reminder_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automated_reminder_policies_agency_id_kind_key" ON "automated_reminder_policies"("agency_id", "kind");
CREATE INDEX "automated_reminder_policies_agency_id_enabled_idx" ON "automated_reminder_policies"("agency_id", "enabled");
CREATE UNIQUE INDEX "automated_reminder_deliveries_policy_id_target_id_sequence_key" ON "automated_reminder_deliveries"("policy_id", "target_id", "sequence");
CREATE INDEX "automated_reminder_deliveries_agency_id_status_next_attempt_at_idx" ON "automated_reminder_deliveries"("agency_id", "status", "next_attempt_at");
CREATE INDEX "automated_reminder_deliveries_policy_id_target_id_sent_at_idx" ON "automated_reminder_deliveries"("policy_id", "target_id", "sent_at");

ALTER TABLE "automated_reminder_policies"
  ADD CONSTRAINT "automated_reminder_policies_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automated_reminder_deliveries"
  ADD CONSTRAINT "automated_reminder_deliveries_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "automated_reminder_deliveries"
  ADD CONSTRAINT "automated_reminder_deliveries_policy_id_fkey"
  FOREIGN KEY ("policy_id") REFERENCES "automated_reminder_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "automated_reminder_policies"
  ("id", "agency_id", "kind", "enabled", "subject_template", "message_template", "sms_template", "updated_at")
SELECT
  gen_random_uuid()::text,
  agency."id",
  defaults."kind"::"AutomatedReminderKind",
  false,
  defaults."subject_template",
  defaults."message_template",
  defaults."sms_template",
  CURRENT_TIMESTAMP
FROM "agencies" agency
CROSS JOIN (
  VALUES
    ('Invoice', 'Payment reminder — {{itemName}}', E'Hello {{clientName}},\n\nThis is reminder {{reminderNumber}} of {{maxReminders}} that {{itemName}} remains outstanding. It was due on {{dueDate}}.\n\nYou can review payment details here: {{portalLink}}\n\n{{agencyName}}', '{{agencyName}}: Payment reminder for {{itemName}}, due {{dueDate}}. View: {{portalLink}}'),
    ('Document', 'Document reminder — {{itemName}}', E'Hello {{clientName}},\n\nWe are still waiting for {{itemName}}. It was due on {{dueDate}}.\n\nPlease upload it securely here: {{portalLink}}\n\n{{agencyName}}', '{{agencyName}}: Please upload {{itemName}}, due {{dueDate}}. Upload: {{portalLink}}'),
    ('Agreement', 'Signature reminder — {{itemName}}', E'Hello {{clientName}},\n\nYour signature is still required for {{itemName}}. Please review and sign it by {{dueDate}}.\n\nOpen the agreement here: {{portalLink}}\n\n{{agencyName}}', '{{agencyName}}: Your signature is required for {{itemName}}. Review: {{portalLink}}'),
    ('Questionnaire', 'Questionnaire reminder — {{itemName}}', E'Hello {{clientName}},\n\nYour questionnaire, {{itemName}}, is still outstanding and was due on {{dueDate}}.\n\nContinue it here: {{portalLink}}\n\n{{agencyName}}', '{{agencyName}}: Please complete {{itemName}}, due {{dueDate}}. Continue: {{portalLink}}')
) AS defaults("kind", "subject_template", "message_template", "sms_template")
ON CONFLICT ("agency_id", "kind") DO NOTHING;
