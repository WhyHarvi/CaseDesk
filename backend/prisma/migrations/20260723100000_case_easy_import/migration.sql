CREATE TYPE "CaseEasyRecordType" AS ENUM ('client', 'prospect');
CREATE TYPE "CaseEasyContactImportStatus" AS ENUM ('imported', 'reviewed', 'converted');
CREATE TYPE "CaseEasyCaseImportStatus" AS ENUM ('imported', 'reviewed', 'converted', 'needs_review');
CREATE TYPE "CaseEasyCaseReviewReason" AS ENUM ('unlinked_contact', 'assignee_mismatch', 'conflicting_toggle');

CREATE TABLE "case_easy_import_contacts" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "uci" TEXT,
  "first_name" TEXT,
  "last_name" TEXT,
  "marital_status" TEXT,
  "date_of_birth" TIMESTAMP(3),
  "email" TEXT,
  "phone" TEXT,
  "country_of_residence" TEXT,
  "noc_teer" TEXT,
  "referral_source" TEXT,
  "source_created" TIMESTAMP(3),
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "import_batch_id" TEXT NOT NULL,
  "record_type" "CaseEasyRecordType",
  "import_status" "CaseEasyContactImportStatus" NOT NULL DEFAULT 'imported',
  "converted_client_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "case_easy_import_contacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_easy_import_contacts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_easy_import_contacts_converted_client_id_fkey" FOREIGN KEY ("converted_client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "case_easy_import_contacts_agency_id_idx" ON "case_easy_import_contacts"("agency_id");
CREATE INDEX "case_easy_import_contacts_agency_id_import_batch_id_idx" ON "case_easy_import_contacts"("agency_id", "import_batch_id");
CREATE INDEX "case_easy_import_contacts_agency_id_email_idx" ON "case_easy_import_contacts"("agency_id", "email");

CREATE TABLE "case_easy_import_cases" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "applicant_id_key" TEXT,
  "case_number" TEXT,
  "company_name" TEXT,
  "status" TEXT,
  "case_type" TEXT,
  "noc_teer" TEXT,
  "job_title" TEXT,
  "assignees" TEXT,
  "referral_source" TEXT,
  "category" TEXT,
  "tags" TEXT,
  "office_location" TEXT,
  "opened" TIMESTAMP(3),
  "approved" TIMESTAMP(3),
  "submitted" TIMESTAMP(3),
  "refused" TIMESTAMP(3),
  "source_created" TIMESTAMP(3),
  "other_contacts" TEXT,
  "primary_address" TEXT,
  "phone" TEXT,
  "other_emails" TEXT,
  "email" TEXT,
  "first_name" TEXT,
  "last_name" TEXT,
  "modified" TIMESTAMP(3),
  "last_note" TEXT,
  "last_note_date" TIMESTAMP(3),
  "prospect_or_client" TEXT,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "import_batch_id" TEXT NOT NULL,
  "linked_contact_id" TEXT,
  "import_status" "CaseEasyCaseImportStatus" NOT NULL DEFAULT 'imported',
  "needs_review_reason" "CaseEasyCaseReviewReason",
  "resolved_assignee_user_id" TEXT,
  "converted_case_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "case_easy_import_cases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_easy_import_cases_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_easy_import_cases_linked_contact_id_fkey" FOREIGN KEY ("linked_contact_id") REFERENCES "case_easy_import_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "case_easy_import_cases_resolved_assignee_user_id_fkey" FOREIGN KEY ("resolved_assignee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "case_easy_import_cases_converted_case_id_fkey" FOREIGN KEY ("converted_case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "case_easy_import_cases_agency_id_idx" ON "case_easy_import_cases"("agency_id");
CREATE INDEX "case_easy_import_cases_agency_id_import_batch_id_idx" ON "case_easy_import_cases"("agency_id", "import_batch_id");
CREATE INDEX "case_easy_import_cases_agency_id_case_number_idx" ON "case_easy_import_cases"("agency_id", "case_number");
CREATE INDEX "case_easy_import_cases_linked_contact_id_idx" ON "case_easy_import_cases"("linked_contact_id");

ALTER TABLE "case_easy_import_contacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "case_easy_import_cases" ENABLE ROW LEVEL SECURITY;

CREATE POLICY case_easy_import_contacts_staff ON "case_easy_import_contacts" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
CREATE POLICY case_easy_import_cases_staff ON "case_easy_import_cases" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
