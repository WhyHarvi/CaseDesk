ALTER TABLE "notifications"
  ADD COLUMN "attention_level" TEXT NOT NULL DEFAULT 'update',
  ADD COLUMN "occurrence_count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "last_occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "resolved_at" TIMESTAMP(3),
  ADD COLUMN "expires_at" TIMESTAMP(3);

UPDATE "notifications"
SET "attention_level" = CASE
  WHEN "severity" IN ('critical', 'warning') THEN 'action_required'
  ELSE 'update'
END,
"last_occurred_at" = "created_at",
"expires_at" = CASE
  WHEN "severity" IN ('critical', 'warning') THEN "created_at" + INTERVAL '90 days'
  ELSE "created_at" + INTERVAL '30 days'
END;

-- Routine events remain available in activity history; they should not keep
-- occupying the notification centre after this policy is introduced.
UPDATE "notifications"
SET "resolved_at" = CURRENT_TIMESTAMP,
    "read_at" = COALESCE("read_at", CURRENT_TIMESTAMP)
WHERE "type" IN (
  'appointment.reminder',
  'appointment.attended',
  'appointment.booked',
  'appointment.confirmed'
);

-- Keep only the latest open copy of an event for the same recipient and
-- subject. Older copies remain stored for audit purposes as resolved rows.
WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "agency_id", "recipient_user_id", "type", "entity_type", "entity_id"
           ORDER BY "created_at" DESC, "id" DESC
         ) AS position
  FROM "notifications"
  WHERE "dismissed_at" IS NULL
    AND "entity_id" IS NOT NULL
)
UPDATE "notifications" AS notification
SET "resolved_at" = CURRENT_TIMESTAMP,
    "read_at" = COALESCE(notification."read_at", CURRENT_TIMESTAMP)
FROM ranked
WHERE notification."id" = ranked."id"
  AND ranked.position > 1;

CREATE INDEX "notifications_recipient_attention_resolved_last_idx"
  ON "notifications"("recipient_user_id", "attention_level", "resolved_at", "last_occurred_at");
CREATE INDEX "notifications_expires_at_idx" ON "notifications"("expires_at");

ALTER TABLE "notification_preferences"
  ADD COLUMN "delivery_mode" TEXT NOT NULL DEFAULT 'immediate',
  ADD COLUMN "digest_hour" INTEGER NOT NULL DEFAULT 9,
  ADD COLUMN "last_digest_at" TIMESTAMP(3);
