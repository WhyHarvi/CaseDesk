-- AlterTable: which working queue a lead lives in (see schema.prisma's
-- comment on LeadPipelineSegment). Replaces the ad-hoc importedRows/
-- activity-title provenance sniffing that used to live in
-- lead.permissions.js with a real, staff-controllable field.
CREATE TYPE "LeadPipelineSegment" AS ENUM ('STANDARD', 'IMPORT_REVIEW');

ALTER TABLE "leads" ADD COLUMN "pipeline_segment" "LeadPipelineSegment" NOT NULL DEFAULT 'STANDARD';

-- One-time backfill: move every lead that came from the Aug 2026 Admissions
-- import batch into IMPORT_REVIEW, using the same two provenance markers the
-- runtime hide-filter used until now — an import-row link for leads created
-- through the CSV pipeline, or the "Admissions detail (imported)" activity
-- for the handful of confirmed-student placeholders created directly by a
-- one-off script (and so never got a lead_import_rows link).
UPDATE "leads" l
SET "pipeline_segment" = 'IMPORT_REVIEW'
WHERE EXISTS (SELECT 1 FROM "lead_import_rows" lir WHERE lir."created_lead_id" = l.id)
   OR EXISTS (SELECT 1 FROM "lead_activities" la WHERE la."lead_id" = l.id AND la.title = 'Admissions detail (imported)');

CREATE INDEX "leads_agency_id_pipeline_segment_idx" ON "leads"("agency_id", "pipeline_segment");
