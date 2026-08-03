CREATE TABLE "lead_message_deliveries" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "lead_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "sent_at" TIMESTAMP(3),
  "failed_at" TIMESTAMP(3),
  "provider" TEXT,
  "provider_id" TEXT,
  "last_error" TEXT,
  "dedupe_key" TEXT NOT NULL,
  "subject" TEXT,
  "body" TEXT,
  "source_channel" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "lead_message_deliveries_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "lead_message_deliveries"
  ADD CONSTRAINT "lead_message_deliveries_agency_id_fkey"
  FOREIGN KEY ("agency_id") REFERENCES "agencies"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "lead_message_deliveries"
  ADD CONSTRAINT "lead_message_deliveries_lead_id_fkey"
  FOREIGN KEY ("lead_id") REFERENCES "leads"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "lead_message_deliveries_agency_id_dedupe_key_key"
  ON "lead_message_deliveries"("agency_id", "dedupe_key");

CREATE INDEX "lead_message_deliveries_lead_id_created_at_idx"
  ON "lead_message_deliveries"("lead_id", "created_at");

CREATE INDEX "lead_message_deliveries_agency_id_status_created_at_idx"
  ON "lead_message_deliveries"("agency_id", "status", "created_at");

-- Before this table existed, website welcomes were sent best-effort without
-- a durable result. Surface those attempts honestly instead of claiming that
-- they were delivered or hiding them from the lead timeline.
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
  jsonb_build_object('historical', true, 'incomingEventId', event."id"),
  COALESCE(event."processed_at", event."created_at"),
  CURRENT_TIMESTAMP
FROM "lead_incoming_events" AS event
JOIN "leads" AS lead ON lead."id" = event."processed_lead_id"
WHERE event."channel" = 'WEBSITE_CONNECTOR'
  AND event."status" = 'PROCESSED'
  AND event."processed_lead_id" IS NOT NULL
  AND lead."deleted_at" IS NULL
  AND COALESCE(lead."email", lead."phone") IS NOT NULL
ON CONFLICT ("agency_id", "dedupe_key") DO NOTHING;
