-- A website intake could finish while the application instances were rolling
-- over to durable lead-message tracking. Repair only leads that still have no
-- welcome record, and never imply that an old attempt was delivered.
INSERT INTO "lead_message_deliveries" (
  "id",
  "agency_id",
  "lead_id",
  "kind",
  "channel",
  "recipient",
  "status",
  "attempts",
  "last_error",
  "dedupe_key",
  "source_channel",
  "payload",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid()::text,
  event."agency_id",
  event."processed_lead_id",
  'welcome',
  CASE WHEN lead."email" IS NOT NULL THEN 'email' ELSE 'sms' END,
  COALESCE(lead."email", lead."phone"),
  'untracked',
  1,
  'This welcome was processed before lead message tracking was enabled, so its delivery outcome is unavailable.',
  'lead-welcome:' || lead."id",
  event."channel",
  jsonb_build_object('historical', true, 'incomingEventId', event."id", 'repaired', true),
  COALESCE(event."processed_at", event."created_at"),
  CURRENT_TIMESTAMP
FROM "lead_incoming_events" AS event
JOIN "leads" AS lead ON lead."id" = event."processed_lead_id"
WHERE event."channel" = 'WEBSITE_CONNECTOR'
  AND event."status" = 'PROCESSED'
  AND event."processed_lead_id" IS NOT NULL
  AND lead."deleted_at" IS NULL
  AND COALESCE(lead."email", lead."phone") IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "lead_message_deliveries" AS delivery
    WHERE delivery."agency_id" = event."agency_id"
      AND delivery."dedupe_key" = 'lead-welcome:' || lead."id"
  )
ON CONFLICT ("agency_id", "dedupe_key") DO NOTHING;
