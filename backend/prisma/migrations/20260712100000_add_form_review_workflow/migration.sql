ALTER TYPE "FormStatus" ADD VALUE IF NOT EXISTS 'Information Missing';
ALTER TYPE "FormStatus" ADD VALUE IF NOT EXISTS 'Ready to Fill';
ALTER TYPE "FormStatus" ADD VALUE IF NOT EXISTS 'Signature Required';
ALTER TYPE "FormStatus" ADD VALUE IF NOT EXISTS 'Signed';

CREATE TABLE "case_form_review_comments" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_form_id" TEXT NOT NULL,
  "page_number" INTEGER,
  "field_name" TEXT,
  "comment" TEXT NOT NULL,
  "resolved_at" TIMESTAMP(3),
  "created_by_id" TEXT NOT NULL,
  "resolved_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "case_form_review_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "case_form_review_comments_agency_id_idx" ON "case_form_review_comments"("agency_id");
CREATE INDEX "case_form_review_comments_case_form_id_idx" ON "case_form_review_comments"("case_form_id");
CREATE INDEX "case_form_review_comments_created_by_id_idx" ON "case_form_review_comments"("created_by_id");
CREATE INDEX "case_form_review_comments_resolved_by_id_idx" ON "case_form_review_comments"("resolved_by_id");

ALTER TABLE "case_form_review_comments" ADD CONSTRAINT "case_form_review_comments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_form_review_comments" ADD CONSTRAINT "case_form_review_comments_case_form_id_fkey" FOREIGN KEY ("case_form_id") REFERENCES "case_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_form_review_comments" ADD CONSTRAINT "case_form_review_comments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "case_form_review_comments" ADD CONSTRAINT "case_form_review_comments_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
