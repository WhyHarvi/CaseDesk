ALTER TABLE "case_forms"
  ADD COLUMN "locked_at" TIMESTAMP(3),
  ADD COLUMN "locked_by_id" TEXT;

ALTER TYPE "CaseFormVersionSource" ADD VALUE IF NOT EXISTS 'Finalized';

CREATE TABLE "form_permissions" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "can_assign" BOOLEAN NOT NULL DEFAULT true,
  "can_edit" BOOLEAN NOT NULL DEFAULT true,
  "can_review" BOOLEAN NOT NULL DEFAULT true,
  "can_approve" BOOLEAN NOT NULL DEFAULT false,
  "can_finalize" BOOLEAN NOT NULL DEFAULT false,
  "can_delete" BOOLEAN NOT NULL DEFAULT false,
  "can_unlock" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "form_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "form_permissions_user_id_key" ON "form_permissions"("user_id");
CREATE INDEX "form_permissions_agency_id_idx" ON "form_permissions"("agency_id");
CREATE INDEX "case_forms_locked_by_id_idx" ON "case_forms"("locked_by_id");

ALTER TABLE "form_permissions" ADD CONSTRAINT "form_permissions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_permissions" ADD CONSTRAINT "form_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "case_forms" ADD CONSTRAINT "case_forms_locked_by_id_fkey" FOREIGN KEY ("locked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
