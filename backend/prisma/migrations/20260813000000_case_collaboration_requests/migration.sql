-- Consultant self-service "request to join a case" workflow (Team Workload
-- refinement plan, Phase 4). A request is just an ask; approving it still
-- goes through the existing case-permissions endpoint to actually create the
-- CaseAssignment row, so this table only records the request lifecycle.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CaseCollaborationRequestStatus') THEN
    CREATE TYPE "CaseCollaborationRequestStatus" AS ENUM ('Pending', 'Approved', 'Declined', 'Withdrawn');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "case_collaboration_requests" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "requested_by_id" TEXT NOT NULL,
  "requested_role" "AssignmentType" NOT NULL DEFAULT 'supporting',
  "note" TEXT,
  "status" "CaseCollaborationRequestStatus" NOT NULL DEFAULT 'Pending',
  "reviewed_by_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "review_note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_collaboration_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "case_collaboration_requests_agency_id_status_idx" ON "case_collaboration_requests"("agency_id", "status");
CREATE INDEX IF NOT EXISTS "case_collaboration_requests_case_id_status_idx" ON "case_collaboration_requests"("case_id", "status");
CREATE INDEX IF NOT EXISTS "case_collaboration_requests_requested_by_id_status_idx" ON "case_collaboration_requests"("requested_by_id", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_collaboration_requests_agency_id_fkey'
  ) THEN
    ALTER TABLE "case_collaboration_requests"
      ADD CONSTRAINT "case_collaboration_requests_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_collaboration_requests_case_id_fkey'
  ) THEN
    ALTER TABLE "case_collaboration_requests"
      ADD CONSTRAINT "case_collaboration_requests_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_collaboration_requests_requested_by_id_fkey'
  ) THEN
    ALTER TABLE "case_collaboration_requests"
      ADD CONSTRAINT "case_collaboration_requests_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'case_collaboration_requests_reviewed_by_id_fkey'
  ) THEN
    ALTER TABLE "case_collaboration_requests"
      ADD CONSTRAINT "case_collaboration_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "case_collaboration_requests" ENABLE ROW LEVEL SECURITY;

-- Backend's own Prisma connection (service role) does all real reads/writes
-- for the request/approve/decline endpoints and enforces "own requests only"
-- for non-admins at the application layer; this policy is the same
-- defense-in-depth net used on cash_reconciliations and
-- user_portal_activity — agency-scoped, staff roles that can plausibly
-- touch case work (admin/consultant/frontdesk) pass, matching the existing
-- convention of not having a per-row current-user() Postgres helper.
DROP POLICY IF EXISTS case_collaboration_requests_staff ON "case_collaboration_requests";
CREATE POLICY case_collaboration_requests_staff ON "case_collaboration_requests" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant', 'frontdesk'))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin', 'consultant', 'frontdesk'));
