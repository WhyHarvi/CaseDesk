CREATE TYPE "LeadIncomingEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'DUPLICATE_REVIEW', 'FAILED');
CREATE TYPE "LeadImportBatchStatus" AS ENUM ('PREVIEW', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "LeadImportRowStatus" AS ENUM ('VALID', 'INVALID', 'QUEUED', 'PROCESSED', 'DUPLICATE', 'FAILED');
CREATE TYPE "LeadDuplicateStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DISMISSED');

CREATE TABLE "lead_intake_forms" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "source_id" TEXT NOT NULL REFERENCES "lead_sources"("id") ON DELETE RESTRICT,
  "campaign_id" TEXT REFERENCES "lead_campaigns"("id") ON DELETE SET NULL,
  "owner_user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "name" TEXT NOT NULL,
  "public_token" TEXT NOT NULL UNIQUE,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "require_consent" BOOLEAN NOT NULL DEFAULT true,
  "first_response_minutes" INTEGER NOT NULL DEFAULT 15,
  "success_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "lead_intake_forms_response_check" CHECK ("first_response_minutes" BETWEEN 1 AND 10080)
);
CREATE UNIQUE INDEX "lead_intake_forms_agency_id_name_key" ON "lead_intake_forms"("agency_id", "name");
CREATE INDEX "lead_intake_forms_agency_id_is_active_idx" ON "lead_intake_forms"("agency_id", "is_active");

CREATE TABLE "lead_import_batches" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "source_id" TEXT NOT NULL REFERENCES "lead_sources"("id") ON DELETE RESTRICT,
  "uploaded_by_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "file_name" TEXT NOT NULL,
  "status" "LeadImportBatchStatus" NOT NULL DEFAULT 'PREVIEW',
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "valid_rows" INTEGER NOT NULL DEFAULT 0,
  "invalid_rows" INTEGER NOT NULL DEFAULT 0,
  "processed_rows" INTEGER NOT NULL DEFAULT 0,
  "duplicate_rows" INTEGER NOT NULL DEFAULT 0,
  "failed_rows" INTEGER NOT NULL DEFAULT 0,
  "settings" JSONB NOT NULL DEFAULT '{}',
  "committed_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "lead_import_batches_agency_id_created_at_idx" ON "lead_import_batches"("agency_id", "created_at");
CREATE INDEX "lead_import_batches_agency_id_status_idx" ON "lead_import_batches"("agency_id", "status");

CREATE TABLE "lead_import_rows" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "batch_id" TEXT NOT NULL REFERENCES "lead_import_batches"("id") ON DELETE CASCADE,
  "row_number" INTEGER NOT NULL,
  "raw_data" JSONB NOT NULL,
  "normalized_data" JSONB,
  "validation_errors" JSONB NOT NULL DEFAULT '[]',
  "status" "LeadImportRowStatus" NOT NULL,
  "created_lead_id" TEXT REFERENCES "leads"("id") ON DELETE SET NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "lead_import_rows_batch_id_row_number_key" ON "lead_import_rows"("batch_id", "row_number");
CREATE INDEX "lead_import_rows_agency_id_status_idx" ON "lead_import_rows"("agency_id", "status");

CREATE TABLE "lead_incoming_events" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "source_id" TEXT NOT NULL REFERENCES "lead_sources"("id") ON DELETE RESTRICT,
  "campaign_id" TEXT REFERENCES "lead_campaigns"("id") ON DELETE SET NULL,
  "intake_form_id" TEXT REFERENCES "lead_intake_forms"("id") ON DELETE SET NULL,
  "import_batch_id" TEXT REFERENCES "lead_import_batches"("id") ON DELETE SET NULL,
  "import_row_id" TEXT UNIQUE REFERENCES "lead_import_rows"("id") ON DELETE SET NULL,
  "processed_lead_id" TEXT REFERENCES "leads"("id") ON DELETE SET NULL,
  "channel" TEXT NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "raw_payload" JSONB NOT NULL,
  "normalized_payload" JSONB,
  "status" "LeadIncomingEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "processed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "lead_incoming_events_agency_id_idempotency_key_key" ON "lead_incoming_events"("agency_id", "idempotency_key");
CREATE INDEX "lead_incoming_events_status_available_at_idx" ON "lead_incoming_events"("status", "available_at");
CREATE INDEX "lead_incoming_events_agency_id_created_at_idx" ON "lead_incoming_events"("agency_id", "created_at");

CREATE TABLE "lead_duplicate_candidates" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "incoming_event_id" TEXT NOT NULL REFERENCES "lead_incoming_events"("id") ON DELETE CASCADE,
  "candidate_lead_id" TEXT NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "score" INTEGER NOT NULL,
  "reasons" JSONB NOT NULL DEFAULT '[]',
  "status" "LeadDuplicateStatus" NOT NULL DEFAULT 'PENDING',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "lead_duplicate_candidates_incoming_event_id_candidate_lead_id_key" ON "lead_duplicate_candidates"("incoming_event_id", "candidate_lead_id");
CREATE INDEX "lead_duplicate_candidates_agency_id_status_created_at_idx" ON "lead_duplicate_candidates"("agency_id", "status", "created_at");

ALTER TABLE "lead_intake_forms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_import_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_import_rows" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_incoming_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_duplicate_candidates" ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_intake_forms_access ON "lead_intake_forms" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY lead_import_batches_access ON "lead_import_batches" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY lead_import_rows_access ON "lead_import_rows" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY lead_incoming_events_access ON "lead_incoming_events" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY lead_duplicate_candidates_access ON "lead_duplicate_candidates" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
