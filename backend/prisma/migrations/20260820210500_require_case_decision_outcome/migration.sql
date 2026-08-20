-- Tighten the Decision Received transition: dates alone are not enough.
-- The lifecycle endpoint writes case_decisions first in the same transaction,
-- then changes Case.stage, so this check is visible atomically.
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
    IF TG_OP = 'INSERT' OR NOT EXISTS (
      SELECT 1 FROM "case_decisions" decision
      WHERE decision."case_id" = NEW."id"
        AND decision."agency_id" = NEW."agency_id"
    ) THEN
      RAISE EXCEPTION 'Approved or Refused decision details are required before moving a case to Decision Received.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
