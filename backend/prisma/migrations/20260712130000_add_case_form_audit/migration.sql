CREATE TABLE "case_form_audit_events" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_form_id" TEXT,
  "case_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "form_title" TEXT NOT NULL,
  "form_number" TEXT,
  "event" TEXT NOT NULL,
  "details" TEXT,
  "metadata" JSONB,
  "user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_form_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "case_form_audit_events_agency_id_idx" ON "case_form_audit_events"("agency_id");
CREATE INDEX "case_form_audit_events_case_form_id_idx" ON "case_form_audit_events"("case_form_id");
CREATE INDEX "case_form_audit_events_case_id_idx" ON "case_form_audit_events"("case_id");
CREATE INDEX "case_form_audit_events_user_id_idx" ON "case_form_audit_events"("user_id");

ALTER TABLE "case_form_audit_events" ADD CONSTRAINT "case_form_audit_events_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_form_audit_events" ADD CONSTRAINT "case_form_audit_events_case_form_id_fkey" FOREIGN KEY ("case_form_id") REFERENCES "case_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "case_form_audit_events" ADD CONSTRAINT "case_form_audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
