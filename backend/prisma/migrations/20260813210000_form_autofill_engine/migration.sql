-- Government form auto-fill engine (IMM 5476 and future forms).

ALTER TYPE "CaseFormVersionSource" ADD VALUE IF NOT EXISTS 'Generated';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FormFieldOwner') THEN
    CREATE TYPE "FormFieldOwner" AS ENUM ('Client', 'Representative', 'Case', 'Manual');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FormFieldType') THEN
    CREATE TYPE "FormFieldType" AS ENUM ('Text', 'Checkbox', 'Radio', 'Dropdown', 'Date', 'Signature');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FormFieldFillableBy') THEN
    CREATE TYPE "FormFieldFillableBy" AS ENUM ('Consultant', 'Client', 'Both');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FormFieldValueStatus') THEN
    CREATE TYPE "FormFieldValueStatus" AS ENUM ('Unset', 'Auto-filled', 'Consultant Entered', 'Client Entered');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CaseFormClientRequestStatus') THEN
    CREATE TYPE "CaseFormClientRequestStatus" AS ENUM ('Sent', 'In Progress', 'Submitted', 'Reviewed');
  END IF;
END $$;

-- Client: structured name split + UCI
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "family_name" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "given_names" TEXT;
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "uci" TEXT;

-- Case: IRCC application number
ALTER TABLE "cases" ADD COLUMN IF NOT EXISTS "application_number" TEXT;

-- User: representative-of-record fields (admin or consultant can be picked)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "representative_type" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "membership_body" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "membership_province" TEXT;

-- Agency: fax + apt/unit, single source for the representative's mailing address
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "fax_number" TEXT;
ALTER TABLE "agencies" ADD COLUMN IF NOT EXISTS "address_unit" TEXT;

-- CaseForm: which applicant this copy is for + who is the representative
ALTER TABLE "case_forms" ADD COLUMN IF NOT EXISTS "applicant_profile_id" TEXT;
ALTER TABLE "case_forms" ADD COLUMN IF NOT EXISTS "representative_user_id" TEXT;

CREATE INDEX IF NOT EXISTS "case_forms_applicant_profile_id_idx" ON "case_forms"("applicant_profile_id");
CREATE INDEX IF NOT EXISTS "case_forms_representative_user_id_idx" ON "case_forms"("representative_user_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_forms_applicant_profile_id_fkey') THEN
    ALTER TABLE "case_forms" ADD CONSTRAINT "case_forms_applicant_profile_id_fkey" FOREIGN KEY ("applicant_profile_id") REFERENCES "immigration_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_forms_representative_user_id_fkey') THEN
    ALTER TABLE "case_forms" ADD CONSTRAINT "case_forms_representative_user_id_fkey" FOREIGN KEY ("representative_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Per-field definition for a form template, created once on import, reused by every case
CREATE TABLE IF NOT EXISTS "form_template_field_schemas" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "agency_form_template_id" TEXT NOT NULL,
  "field_key" TEXT NOT NULL,
  "field_type" "FormFieldType" NOT NULL DEFAULT 'Text',
  "page" INTEGER,
  "section" TEXT,
  "sort_index" INTEGER NOT NULL DEFAULT 0,
  "label" TEXT NOT NULL,
  "help_text" TEXT,
  "owner" "FormFieldOwner" NOT NULL DEFAULT 'Manual',
  "source_path" TEXT,
  "is_required" BOOLEAN NOT NULL DEFAULT false,
  "condition" JSONB,
  "fillable_by" "FormFieldFillableBy" NOT NULL DEFAULT 'Consultant',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "form_template_field_schemas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "form_template_field_schemas_agency_form_template_id_field_key_key" ON "form_template_field_schemas"("agency_form_template_id", "field_key");
CREATE INDEX IF NOT EXISTS "form_template_field_schemas_agency_id_idx" ON "form_template_field_schemas"("agency_id");
CREATE INDEX IF NOT EXISTS "form_template_field_schemas_agency_form_template_id_idx" ON "form_template_field_schemas"("agency_form_template_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_template_field_schemas_agency_id_fkey') THEN
    ALTER TABLE "form_template_field_schemas" ADD CONSTRAINT "form_template_field_schemas_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'form_template_field_schemas_agency_form_template_id_fkey') THEN
    ALTER TABLE "form_template_field_schemas" ADD CONSTRAINT "form_template_field_schemas_agency_form_template_id_fkey" FOREIGN KEY ("agency_form_template_id") REFERENCES "agency_form_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Live checklist data: one row per field per case-specific CaseForm instance
CREATE TABLE IF NOT EXISTS "case_form_field_values" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_form_id" TEXT NOT NULL,
  "field_key" TEXT NOT NULL,
  "value" TEXT,
  "status" "FormFieldValueStatus" NOT NULL DEFAULT 'Unset',
  "filled_by_id" TEXT,
  "filled_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_form_field_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "case_form_field_values_case_form_id_field_key_key" ON "case_form_field_values"("case_form_id", "field_key");
CREATE INDEX IF NOT EXISTS "case_form_field_values_agency_id_idx" ON "case_form_field_values"("agency_id");
CREATE INDEX IF NOT EXISTS "case_form_field_values_case_form_id_idx" ON "case_form_field_values"("case_form_id");
CREATE INDEX IF NOT EXISTS "case_form_field_values_filled_by_id_idx" ON "case_form_field_values"("filled_by_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_form_field_values_agency_id_fkey') THEN
    ALTER TABLE "case_form_field_values" ADD CONSTRAINT "case_form_field_values_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_form_field_values_case_form_id_fkey') THEN
    ALTER TABLE "case_form_field_values" ADD CONSTRAINT "case_form_field_values_case_form_id_fkey" FOREIGN KEY ("case_form_id") REFERENCES "case_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_form_field_values_filled_by_id_fkey') THEN
    ALTER TABLE "case_form_field_values" ADD CONSTRAINT "case_form_field_values_filled_by_id_fkey" FOREIGN KEY ("filled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- "Send the remaining fields to the client" — portal-facing assignment
CREATE TABLE IF NOT EXISTS "case_form_client_requests" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_form_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "requested_field_keys" JSONB NOT NULL DEFAULT '[]',
  "status" "CaseFormClientRequestStatus" NOT NULL DEFAULT 'Sent',
  "message" TEXT,
  "due_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "submitted_at" TIMESTAMP(3),
  "reviewed_at" TIMESTAMP(3),
  "reviewed_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_form_client_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "case_form_client_requests_agency_id_status_idx" ON "case_form_client_requests"("agency_id", "status");
CREATE INDEX IF NOT EXISTS "case_form_client_requests_case_form_id_idx" ON "case_form_client_requests"("case_form_id");
CREATE INDEX IF NOT EXISTS "case_form_client_requests_case_id_idx" ON "case_form_client_requests"("case_id");
CREATE INDEX IF NOT EXISTS "case_form_client_requests_client_id_idx" ON "case_form_client_requests"("client_id");
CREATE INDEX IF NOT EXISTS "case_form_client_requests_reviewed_by_id_idx" ON "case_form_client_requests"("reviewed_by_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_form_client_requests_agency_id_fkey') THEN
    ALTER TABLE "case_form_client_requests" ADD CONSTRAINT "case_form_client_requests_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_form_client_requests_case_form_id_fkey') THEN
    ALTER TABLE "case_form_client_requests" ADD CONSTRAINT "case_form_client_requests_case_form_id_fkey" FOREIGN KEY ("case_form_id") REFERENCES "case_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_form_client_requests_case_id_fkey') THEN
    ALTER TABLE "case_form_client_requests" ADD CONSTRAINT "case_form_client_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_form_client_requests_client_id_fkey') THEN
    ALTER TABLE "case_form_client_requests" ADD CONSTRAINT "case_form_client_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_form_client_requests_reviewed_by_id_fkey') THEN
    ALTER TABLE "case_form_client_requests" ADD CONSTRAINT "case_form_client_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
