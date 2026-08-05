-- AlterTable: when the inquiry actually came in, distinct from created_at
-- (which for imported/backfilled leads is just whenever the import ran).
-- Existing rows default to their own created_at so nothing is left null.
ALTER TABLE "leads" ADD COLUMN "inquiry_date" TIMESTAMP(3);
UPDATE "leads" SET "inquiry_date" = "created_at" WHERE "inquiry_date" IS NULL;
ALTER TABLE "leads" ALTER COLUMN "inquiry_date" SET NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "inquiry_date" SET DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "leads_agency_id_inquiry_date_idx" ON "leads"("agency_id", "inquiry_date");
