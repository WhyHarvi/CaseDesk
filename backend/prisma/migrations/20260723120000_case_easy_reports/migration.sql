CREATE TYPE "CaseEasyReportType" AS ENUM (
  'payment_requests',
  'invoices',
  'payments',
  'receipts',
  'account_receivables',
  'retainer_balances',
  'client_listing',
  'trust_balances',
  'reminders',
  'time_entries',
  'trust_account_entries',
  'activity_tracker',
  'case_information',
  'employers_applications',
  'e_signatures'
);

CREATE TYPE "CaseEasyReportLinkStatus" AS ENUM ('linked', 'unlinked', 'ambiguous');
CREATE TYPE "CaseEasyReportImportStatus" AS ENUM ('imported', 'reviewed');

ALTER TABLE "case_easy_import_contacts"
  ADD COLUMN "client_identifier" TEXT;

ALTER TABLE "case_easy_import_cases"
  ADD COLUMN "client_identifier" TEXT,
  ADD COLUMN "needs_review_reasons" "CaseEasyCaseReviewReason"[] NOT NULL DEFAULT ARRAY[]::"CaseEasyCaseReviewReason"[],
  ADD COLUMN "foreign_national_arrival_date" TIMESTAMP(3),
  ADD COLUMN "resubmission_date" TIMESTAMP(3),
  ADD COLUMN "extension_submission_date" TIMESTAMP(3),
  ADD COLUMN "instructions_sent_date" TIMESTAMP(3),
  ADD COLUMN "returned_date" TIMESTAMP(3),
  ADD COLUMN "deferral_received_date" TIMESTAMP(3);

CREATE INDEX "case_easy_import_contacts_agency_id_client_identifier_idx"
  ON "case_easy_import_contacts"("agency_id", "client_identifier");
CREATE INDEX "case_easy_import_cases_agency_id_client_identifier_idx"
  ON "case_easy_import_cases"("agency_id", "client_identifier");

CREATE TABLE "case_easy_import_report_rows" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "report_type" "CaseEasyReportType" NOT NULL,
  "source_row_key" TEXT NOT NULL,
  "case_number" TEXT,
  "uci" TEXT,
  "client_identifier" TEXT,
  "full_name" TEXT,
  "email" TEXT,
  "case_type" TEXT,
  "case_status" TEXT,
  "first_name" TEXT,
  "last_name" TEXT,
  "company_name" TEXT,
  "raw_data" JSONB NOT NULL,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "import_batch_id" TEXT NOT NULL,
  "import_status" "CaseEasyReportImportStatus" NOT NULL DEFAULT 'imported',
  "link_status" "CaseEasyReportLinkStatus" NOT NULL DEFAULT 'unlinked',
  "link_reason" TEXT,
  "linked_contact_id" TEXT,
  "linked_import_case_id" TEXT,
  "linked_client_id" TEXT,
  "linked_case_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "case_easy_import_report_rows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_easy_import_report_rows_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_easy_import_report_rows_linked_contact_id_fkey"
    FOREIGN KEY ("linked_contact_id") REFERENCES "case_easy_import_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "case_easy_import_report_rows_linked_import_case_id_fkey"
    FOREIGN KEY ("linked_import_case_id") REFERENCES "case_easy_import_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "case_easy_import_report_rows_linked_client_id_fkey"
    FOREIGN KEY ("linked_client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "case_easy_import_report_rows_linked_case_id_fkey"
    FOREIGN KEY ("linked_case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "case_easy_import_report_rows_agency_id_report_type_source_row_key_key"
  ON "case_easy_import_report_rows"("agency_id", "report_type", "source_row_key");
CREATE INDEX "case_easy_import_report_rows_agency_id_report_type_imported_at_idx"
  ON "case_easy_import_report_rows"("agency_id", "report_type", "imported_at");
CREATE INDEX "case_easy_import_report_rows_agency_id_client_identifier_idx"
  ON "case_easy_import_report_rows"("agency_id", "client_identifier");
CREATE INDEX "case_easy_import_report_rows_agency_id_case_number_idx"
  ON "case_easy_import_report_rows"("agency_id", "case_number");
CREATE INDEX "case_easy_import_report_rows_linked_contact_id_idx"
  ON "case_easy_import_report_rows"("linked_contact_id");
CREATE INDEX "case_easy_import_report_rows_linked_import_case_id_idx"
  ON "case_easy_import_report_rows"("linked_import_case_id");
CREATE INDEX "case_easy_import_report_rows_linked_client_id_idx"
  ON "case_easy_import_report_rows"("linked_client_id");
CREATE INDEX "case_easy_import_report_rows_linked_case_id_idx"
  ON "case_easy_import_report_rows"("linked_case_id");

ALTER TABLE "case_easy_import_report_rows" ENABLE ROW LEVEL SECURITY;

CREATE POLICY case_easy_import_report_rows_staff
  ON "case_easy_import_report_rows"
  FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');

-- Re-assert admin-only access for installations where the Phase 1
-- migration was applied before its policy was tightened.
DROP POLICY IF EXISTS case_easy_import_contacts_staff ON "case_easy_import_contacts";
CREATE POLICY case_easy_import_contacts_staff
  ON "case_easy_import_contacts"
  FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');

DROP POLICY IF EXISTS case_easy_import_cases_staff ON "case_easy_import_cases";
CREATE POLICY case_easy_import_cases_staff
  ON "case_easy_import_cases"
  FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
