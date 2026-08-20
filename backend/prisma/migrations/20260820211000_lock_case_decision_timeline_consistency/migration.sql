-- Keep Case.decision_at and the canonical case_decisions decision_date in
-- lockstep when lifecycle facts change. Unrelated edits on legacy rows are
-- not blocked; touching the lifecycle forces the row to be repaired.
CREATE OR REPLACE FUNCTION "enforce_case_lifecycle_dates"()
RETURNS TRIGGER AS $$
DECLARE
  stored_decision_date DATE;
BEGIN
  IF NEW."stage" = 'Submitted'
     AND (
       TG_OP = 'INSERT'
       OR OLD."stage" IS DISTINCT FROM NEW."stage"
       OR OLD."submitted_at" IS DISTINCT FROM NEW."submitted_at"
     )
     AND NEW."submitted_at" IS NULL THEN
    RAISE EXCEPTION 'Submitted date is required before moving a case to Submitted.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."stage" = 'Decision Received'
     AND (
       TG_OP = 'INSERT'
       OR OLD."stage" IS DISTINCT FROM NEW."stage"
       OR OLD."submitted_at" IS DISTINCT FROM NEW."submitted_at"
       OR OLD."decision_at" IS DISTINCT FROM NEW."decision_at"
     ) THEN
    IF NEW."submitted_at" IS NULL THEN
      RAISE EXCEPTION 'Submitted date is required before recording a decision.' USING ERRCODE = '23514';
    END IF;
    IF NEW."decision_at" IS NULL THEN
      RAISE EXCEPTION 'Decision date is required before moving a case to Decision Received.' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Approved or Refused decision details are required before creating a case at Decision Received.'
        USING ERRCODE = '23514';
    END IF;

    SELECT decision."decision_date"
      INTO stored_decision_date
      FROM "case_decisions" decision
      WHERE decision."case_id" = NEW."id"
        AND decision."agency_id" = NEW."agency_id"
      LIMIT 1;

    IF stored_decision_date IS NULL THEN
      RAISE EXCEPTION 'Approved or Refused decision details are required before moving a case to Decision Received.'
        USING ERRCODE = '23514';
    END IF;
    IF stored_decision_date IS DISTINCT FROM NEW."decision_at"::date THEN
      RAISE EXCEPTION 'Decision date must match the recorded Approved or Refused decision.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
