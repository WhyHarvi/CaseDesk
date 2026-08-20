-- Canonical application-decision record. Case keeps the existing submitted_at
-- and decision_at timeline dates; this table stores the decision-specific
-- outcome and the new permit/status expiry that drives proactive outreach.
CREATE TABLE IF NOT EXISTS "case_decisions" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "agency_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "decision_outcome" TEXT NOT NULL,
  "decision_date" DATE NOT NULL,
  "permit_expiry_date" DATE,
  "refusal_resolution" TEXT,
  "successor_case_id" TEXT,
  "recorded_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "case_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "case_decisions_case_id_key" UNIQUE ("case_id"),
  CONSTRAINT "case_decisions_outcome_check" CHECK ("decision_outcome" IN ('APPROVED', 'REFUSED')),
  CONSTRAINT "case_decisions_refusal_resolution_check" CHECK (
    "refusal_resolution" IS NULL OR "refusal_resolution" IN ('NEW_CASE', 'CLOSE_FILE')
  ),
  CONSTRAINT "case_decisions_approval_expiry_check" CHECK (
    ("decision_outcome" = 'APPROVED' AND "permit_expiry_date" IS NOT NULL AND "refusal_resolution" IS NULL)
    OR
    ("decision_outcome" = 'REFUSED' AND "permit_expiry_date" IS NULL AND "refusal_resolution" IS NOT NULL)
  ),
  CONSTRAINT "case_decisions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "case_decisions_successor_case_id_fkey" FOREIGN KEY ("successor_case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "case_decisions_agency_expiry_idx"
  ON "case_decisions" ("agency_id", "permit_expiry_date");
CREATE INDEX IF NOT EXISTS "case_decisions_successor_idx"
  ON "case_decisions" ("successor_case_id");

-- Keep updated_at reliable even though this table is intentionally accessed
-- with SQL rather than a Prisma model (so adding this lifecycle does not force
-- a generated-client/schema coupling across deployments).
CREATE OR REPLACE FUNCTION "touch_case_decision_updated_at"()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updated_at" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "case_decisions_touch_updated_at" ON "case_decisions";
CREATE TRIGGER "case_decisions_touch_updated_at"
BEFORE UPDATE ON "case_decisions"
FOR EACH ROW EXECUTE FUNCTION "touch_case_decision_updated_at"();

-- Database-level guard so a direct API call or another screen cannot bypass
-- the required lifecycle facts. It only applies when entering these stages,
-- leaving legacy rows untouched during unrelated edits.
CREATE OR REPLACE FUNCTION "enforce_case_lifecycle_dates"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."stage" = 'Submitted'
     AND (TG_OP = 'INSERT' OR OLD."stage" IS DISTINCT FROM NEW."stage")
     AND NEW."submitted_at" IS NULL THEN
    RAISE EXCEPTION 'Submitted date is required before moving a case to Submitted.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."stage" = 'Decision Received'
     AND (TG_OP = 'INSERT' OR OLD."stage" IS DISTINCT FROM NEW."stage") THEN
    IF NEW."submitted_at" IS NULL THEN
      RAISE EXCEPTION 'Submitted date is required before recording a decision.' USING ERRCODE = '23514';
    END IF;
    IF NEW."decision_at" IS NULL THEN
      RAISE EXCEPTION 'Decision date is required before moving a case to Decision Received.' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "cases_enforce_lifecycle_dates" ON "cases";
CREATE TRIGGER "cases_enforce_lifecycle_dates"
BEFORE INSERT OR UPDATE ON "cases"
FOR EACH ROW EXECUTE FUNCTION "enforce_case_lifecycle_dates"();
