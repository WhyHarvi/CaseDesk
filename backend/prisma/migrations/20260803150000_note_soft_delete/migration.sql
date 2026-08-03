ALTER TABLE "notes"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by_id" TEXT;

ALTER TABLE "notes"
  ADD CONSTRAINT "notes_deleted_by_id_fkey"
  FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "notes_deleted_by_id_idx" ON "notes"("deleted_by_id");
CREATE INDEX "notes_agency_id_deleted_at_idx" ON "notes"("agency_id", "deleted_at");
