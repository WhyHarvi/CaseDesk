BEGIN;

ALTER TABLE "client_documents"
  ADD COLUMN IF NOT EXISTS "due_at" TIMESTAMP(3);

ALTER TABLE "follow_ups"
  ADD COLUMN IF NOT EXISTS "reminder_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "notification_channels" TEXT[] NOT NULL DEFAULT ARRAY['in_app']::TEXT[],
  ADD COLUMN IF NOT EXISTS "notify_client" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "questionnaire_assignments" (
  "id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "assessment_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sharing" TEXT NOT NULL DEFAULT 'Internal',
  "status" TEXT NOT NULL DEFAULT 'Assigned',
  "due_at" TIMESTAMP(3),
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMP(3),
  "source_data" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "questionnaire_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "recipient_user_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "type" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "severity" TEXT NOT NULL DEFAULT 'info',
  "entity_type" TEXT,
  "entity_id" TEXT,
  "action_url" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "dedupe_key" TEXT NOT NULL,
  "read_at" TIMESTAMP(3),
  "dismissed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "category" TEXT NOT NULL DEFAULT 'all',
  "in_app_enabled" BOOLEAN NOT NULL DEFAULT true,
  "email_enabled" BOOLEAN NOT NULL DEFAULT false,
  "sms_enabled" BOOLEAN NOT NULL DEFAULT false,
  "due_soon_minutes" INTEGER NOT NULL DEFAULT 1440,
  "quiet_hours_start" TEXT,
  "quiet_hours_end" TEXT,
  "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "notification_id" TEXT NOT NULL,
  "recipient_user_id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sent_at" TIMESTAMP(3),
  "delivered_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "provider_id" TEXT,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

INSERT INTO "questionnaire_assignments" (
  "id", "source_id", "agency_id", "assessment_id", "case_id", "client_id",
  "name", "sharing", "status", "due_at", "locked", "assigned_at", "submitted_at",
  "source_data", "created_at", "updated_at"
)
SELECT
  md5(ca."id" || ':' || (assignment.item_json->>'id')),
  assignment.item_json->>'id',
  ca."agency_id",
  ca."id",
  ca."case_id",
  ca."client_id",
  COALESCE(NULLIF(assignment.item_json->>'name', ''), NULLIF(assignment.item_json->>'applicationType', ''), 'Questionnaire'),
  COALESCE(NULLIF(assignment.item_json->>'sharing', ''), 'Internal'),
  COALESCE(NULLIF(assignment.item_json->>'status', ''), 'Assigned'),
  CASE WHEN COALESCE(assignment.item_json->>'dueDate', '') ~ '^\d{4}-\d{2}-\d{2}' THEN (assignment.item_json->>'dueDate')::TIMESTAMP ELSE NULL END,
  COALESCE((assignment.item_json->>'locked')::BOOLEAN, false),
  CASE WHEN COALESCE(assignment.item_json->>'assignedAt', '') ~ '^\d{4}-\d{2}-\d{2}' THEN (assignment.item_json->>'assignedAt')::TIMESTAMP ELSE ca."created_at" END,
  CASE WHEN COALESCE(assignment.item_json->>'submittedAt', '') ~ '^\d{4}-\d{2}-\d{2}' THEN (assignment.item_json->>'submittedAt')::TIMESTAMP ELSE NULL END,
  assignment.item_json,
  ca."created_at",
  ca."updated_at"
FROM "case_assessments" ca
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(ca."form_data"->'questionnaireAssignments', '[]'::jsonb)) AS assignment(item_json)
WHERE NULLIF(assignment.item_json->>'id', '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "questionnaire_assignments" existing
    WHERE existing."assessment_id" = ca."id"
      AND existing."source_id" = (assignment.item_json->>'id')
  );

CREATE UNIQUE INDEX "notifications_agency_id_recipient_user_id_dedupe_key_key"
  ON "notifications"("agency_id", "recipient_user_id", "dedupe_key");
CREATE INDEX "notifications_recipient_user_id_dismissed_at_created_at_idx"
  ON "notifications"("recipient_user_id", "dismissed_at", "created_at");
CREATE INDEX "notifications_recipient_user_id_read_at_created_at_idx"
  ON "notifications"("recipient_user_id", "read_at", "created_at");
CREATE INDEX "notifications_agency_id_category_created_at_idx"
  ON "notifications"("agency_id", "category", "created_at");
CREATE UNIQUE INDEX "notification_preferences_user_id_category_key"
  ON "notification_preferences"("user_id", "category");
CREATE INDEX "notification_preferences_agency_id_idx"
  ON "notification_preferences"("agency_id");
CREATE UNIQUE INDEX "notification_deliveries_notification_id_channel_key"
  ON "notification_deliveries"("notification_id", "channel");
CREATE INDEX "notification_deliveries_status_available_at_idx"
  ON "notification_deliveries"("status", "available_at");
CREATE INDEX "notification_deliveries_recipient_user_id_created_at_idx"
  ON "notification_deliveries"("recipient_user_id", "created_at");
CREATE INDEX "questionnaire_assignments_agency_id_status_due_at_idx"
  ON "questionnaire_assignments"("agency_id", "status", "due_at");
CREATE UNIQUE INDEX "questionnaire_assignments_assessment_id_source_id_key" ON "questionnaire_assignments"("assessment_id", "source_id");
CREATE INDEX "questionnaire_assignments_case_id_idx" ON "questionnaire_assignments"("case_id");
CREATE INDEX "questionnaire_assignments_client_id_idx" ON "questionnaire_assignments"("client_id");
CREATE INDEX "client_documents_agency_id_status_due_at_idx" ON "client_documents"("agency_id", "status", "due_at");
CREATE INDEX "follow_ups_agency_id_status_reminder_at_idx" ON "follow_ups"("agency_id", "status", "reminder_at");

ALTER TABLE "questionnaire_assignments" ADD CONSTRAINT "questionnaire_assignments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "questionnaire_assignments" ADD CONSTRAINT "questionnaire_assignments_assessment_id_fkey" FOREIGN KEY ("assessment_id") REFERENCES "case_assessments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "questionnaire_assignments" ADD CONSTRAINT "questionnaire_assignments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "questionnaire_assignments" ADD CONSTRAINT "questionnaire_assignments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_recipient_user_id_fkey" FOREIGN KEY ("recipient_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
