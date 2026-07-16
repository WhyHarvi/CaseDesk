CREATE TABLE "lead_source_connections" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "source_id" TEXT NOT NULL REFERENCES "lead_sources"("id") ON DELETE RESTRICT,
  "campaign_id" TEXT REFERENCES "lead_campaigns"("id") ON DELETE SET NULL,
  "owner_user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "provider" TEXT NOT NULL DEFAULT 'WEBSITE',
  "name" TEXT NOT NULL,
  "public_token" TEXT NOT NULL UNIQUE,
  "signing_secret_encrypted" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "first_response_minutes" INTEGER NOT NULL DEFAULT 15,
  "allowed_origins" JSONB NOT NULL DEFAULT '[]',
  "last_event_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_source_connections_provider_check" CHECK ("provider" = 'WEBSITE'),
  CONSTRAINT "lead_source_connections_response_check" CHECK ("first_response_minutes" BETWEEN 1 AND 10080),
  CONSTRAINT "lead_source_connections_origins_check" CHECK (jsonb_typeof("allowed_origins") = 'array')
);

CREATE UNIQUE INDEX "lead_source_connections_agency_id_name_key" ON "lead_source_connections"("agency_id", "name");
CREATE INDEX "lead_source_connections_agency_id_provider_is_active_idx" ON "lead_source_connections"("agency_id", "provider", "is_active");

ALTER TABLE "lead_incoming_events" ADD COLUMN "source_connection_id" TEXT REFERENCES "lead_source_connections"("id") ON DELETE SET NULL;
CREATE INDEX "lead_incoming_events_source_connection_id_created_at_idx" ON "lead_incoming_events"("source_connection_id", "created_at");

ALTER TABLE "lead_source_connections" ENABLE ROW LEVEL SECURITY;
CREATE POLICY lead_source_connections_admin ON "lead_source_connections" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
