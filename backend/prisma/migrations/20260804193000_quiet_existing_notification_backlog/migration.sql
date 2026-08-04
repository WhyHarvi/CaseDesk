-- Due-soon notices and reminders belong in Updates or the daily summary.
UPDATE "notifications"
SET "attention_level" = 'update'
WHERE "type" IN (
  'task.due_soon',
  'follow_up.due',
  'client_reminder.due',
  'document.due_soon',
  'questionnaire.due_soon',
  'lead.follow_up_due',
  'lead.first_response_due',
  'lead.next_action_due',
  'lead.consultation_reminder',
  'lead.intake_assigned',
  'appointment.payment_requested'
);

UPDATE "notifications"
SET "attention_level" = 'update'
WHERE "type" = 'appointment.cancelled'
  AND COALESCE(("metadata"->>'paidCancellationReview')::boolean, false) = false;

-- Collapse historical repeating infrastructure failures into the latest open
-- incident per recipient and carry the occurrence total onto that incident.
WITH ranked AS (
  SELECT "id",
         COUNT(*) OVER (PARTITION BY "agency_id", "recipient_user_id", "type") AS total,
         ROW_NUMBER() OVER (
           PARTITION BY "agency_id", "recipient_user_id", "type"
           ORDER BY "created_at" DESC, "id" DESC
         ) AS position
  FROM "notifications"
  WHERE "resolved_at" IS NULL
    AND "type" IN (
      'appointment.delivery_failed',
      'notification.delivery_failed',
      'settings.inbound_mail_sync_failed',
      'settings.personal_mail_sync_failed',
      'settings.system_mail_sync_failed'
    )
)
UPDATE "notifications" AS notification
SET "occurrence_count" = ranked.total
FROM ranked
WHERE notification."id" = ranked."id"
  AND ranked.position = 1;

WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "agency_id", "recipient_user_id", "type"
           ORDER BY "created_at" DESC, "id" DESC
         ) AS position
  FROM "notifications"
  WHERE "resolved_at" IS NULL
    AND "type" IN (
      'appointment.delivery_failed',
      'notification.delivery_failed',
      'settings.inbound_mail_sync_failed',
      'settings.personal_mail_sync_failed',
      'settings.system_mail_sync_failed'
    )
)
UPDATE "notifications" AS notification
SET "resolved_at" = CURRENT_TIMESTAMP,
    "read_at" = COALESCE(notification."read_at", CURRENT_TIMESTAMP)
FROM ranked
WHERE notification."id" = ranked."id"
  AND ranked.position > 1;

-- Resolve reminders whose underlying work has already been completed.
UPDATE "notifications" AS notification
SET "resolved_at" = CURRENT_TIMESTAMP,
    "read_at" = COALESCE(notification."read_at", CURRENT_TIMESTAMP)
WHERE notification."resolved_at" IS NULL
  AND notification."entity_type" = 'task'
  AND EXISTS (
    SELECT 1 FROM "case_workflow_steps" AS task
    WHERE task."id" = notification."entity_id"
      AND (task."is_active" = false OR task."status" IN ('Completed', 'Cancelled'))
  );

UPDATE "notifications" AS notification
SET "resolved_at" = CURRENT_TIMESTAMP,
    "read_at" = COALESCE(notification."read_at", CURRENT_TIMESTAMP)
WHERE notification."resolved_at" IS NULL
  AND notification."entity_type" = 'follow_up'
  AND EXISTS (
    SELECT 1 FROM "follow_ups" AS follow_up
    WHERE follow_up."id" = notification."entity_id"
      AND follow_up."status" IN ('Completed', 'Cancelled')
  );

UPDATE "notifications" AS notification
SET "resolved_at" = CURRENT_TIMESTAMP,
    "read_at" = COALESCE(notification."read_at", CURRENT_TIMESTAMP)
WHERE notification."resolved_at" IS NULL
  AND notification."entity_type" = 'document'
  AND EXISTS (
    SELECT 1 FROM "client_documents" AS document
    WHERE document."id" = notification."entity_id"
      AND document."status" NOT IN ('Requested', 'Changes Requested')
  );

UPDATE "notifications" AS notification
SET "resolved_at" = CURRENT_TIMESTAMP,
    "read_at" = COALESCE(notification."read_at", CURRENT_TIMESTAMP)
WHERE notification."resolved_at" IS NULL
  AND notification."entity_type" = 'questionnaire_assignment'
  AND EXISTS (
    SELECT 1 FROM "questionnaire_assignments" AS questionnaire
    WHERE questionnaire."id" = notification."entity_id"
      AND (questionnaire."status" = 'Submitted' OR questionnaire."locked" = true)
  );
