-- Per-representative government-form signature and draw-only client signing.

CREATE TYPE "CaseFormSignatureRequestStatus" AS ENUM ('Sent', 'Signing', 'Signed', 'Cancelled');
CREATE TYPE "CaseFormSubmissionChannel" AS ENUM ('PortalOrSecureAccount', 'OutsidePortal');

ALTER TABLE "users" ADD COLUMN "form_signature_image" TEXT;
ALTER TABLE "users" ADD COLUMN "form_signature_strokes" JSONB;
ALTER TABLE "users" ADD COLUMN "form_signature_updated_at" TIMESTAMP(3);

CREATE TABLE "case_form_signature_requests" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_form_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "representative_user_id" TEXT NOT NULL,
  "source_storage_key" TEXT NOT NULL,
  "source_file_hash" TEXT,
  "status" "CaseFormSignatureRequestStatus" NOT NULL DEFAULT 'Sent',
  "submission_channel" "CaseFormSubmissionChannel" NOT NULL DEFAULT 'PortalOrSecureAccount',
  "message" TEXT,
  "applicant_name_snapshot" TEXT NOT NULL,
  "representative_name_snapshot" TEXT NOT NULL,
  "representative_licence_snapshot" TEXT NOT NULL,
  "representative_signature_image" TEXT NOT NULL,
  "representative_signature_strokes" JSONB NOT NULL,
  "applicant_signature_image" TEXT,
  "applicant_signature_strokes" JSONB,
  "consented_at" TIMESTAMP(3),
  "signed_at" TIMESTAMP(3),
  "signer_ip" TEXT,
  "signer_user_agent" TEXT,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_form_signature_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "case_form_signature_requests_agency_id_status_idx" ON "case_form_signature_requests"("agency_id", "status");
CREATE INDEX "case_form_signature_requests_case_form_id_status_idx" ON "case_form_signature_requests"("case_form_id", "status");
CREATE INDEX "case_form_signature_requests_client_id_status_idx" ON "case_form_signature_requests"("client_id", "status");

ALTER TABLE "case_form_signature_requests" ADD CONSTRAINT "case_form_signature_requests_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_form_signature_requests" ADD CONSTRAINT "case_form_signature_requests_case_form_id_fkey" FOREIGN KEY ("case_form_id") REFERENCES "case_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_form_signature_requests" ADD CONSTRAINT "case_form_signature_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_form_signature_requests" ADD CONSTRAINT "case_form_signature_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_form_signature_requests" ADD CONSTRAINT "case_form_signature_requests_representative_user_id_fkey" FOREIGN KEY ("representative_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "case_form_signature_requests" ADD CONSTRAINT "case_form_signature_requests_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
