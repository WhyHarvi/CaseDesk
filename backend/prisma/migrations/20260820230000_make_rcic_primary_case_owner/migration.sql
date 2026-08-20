-- Primary case ownership moves from Case Worker to RCIC: the RCIC becomes
-- Case.assigned_user_id, and the Case Worker becomes the mandatory
-- supporting collaborator underneath them (the reverse of how
-- inherit_successor_case_team originally assigned a refusal's successor
-- case). Re-creates the same trigger function with that swap; the trigger
-- itself (case_decisions_inherit_successor_team) is unchanged.
CREATE OR REPLACE FUNCTION "inherit_successor_case_team"()
RETURNS TRIGGER AS $$
DECLARE
  rcic_role_id TEXT;
  worker_role_id TEXT;
  rcic_user_id TEXT;
  worker_user_id TEXT;
BEGIN
  IF NEW."successor_case_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "id" INTO rcic_role_id
  FROM "agency_case_roles"
  WHERE "agency_id" = NEW."agency_id" AND "code" = 'rcic'
  LIMIT 1;

  SELECT "id" INTO worker_role_id
  FROM "agency_case_roles"
  WHERE "agency_id" = NEW."agency_id" AND "code" = 'case-worker'
  LIMIT 1;

  IF rcic_role_id IS NULL OR worker_role_id IS NULL THEN
    RAISE EXCEPTION 'Required RCIC and Case Worker roles must be configured before starting a successor case.'
      USING ERRCODE = '23514';
  END IF;

  SELECT "user_id" INTO rcic_user_id
  FROM "case_role_assignments"
  WHERE "agency_id" = NEW."agency_id"
    AND "case_id" = NEW."case_id"
    AND "case_role_id" = rcic_role_id
    AND "status" = 'active'
  ORDER BY "assigned_at" ASC
  LIMIT 1;

  SELECT "user_id" INTO worker_user_id
  FROM "case_role_assignments"
  WHERE "agency_id" = NEW."agency_id"
    AND "case_id" = NEW."case_id"
    AND "case_role_id" = worker_role_id
    AND "status" = 'active'
  ORDER BY "assigned_at" ASC
  LIMIT 1;

  IF rcic_user_id IS NULL OR worker_user_id IS NULL THEN
    RAISE EXCEPTION 'Assign an RCIC and Case Worker to the refused case before starting another case.'
      USING ERRCODE = '23514';
  END IF;

  UPDATE "cases"
  SET "assigned_user_id" = rcic_user_id
  WHERE "id" = NEW."successor_case_id"
    AND "agency_id" = NEW."agency_id";

  INSERT INTO "case_role_assignments" (
    "id", "agency_id", "case_id", "case_role_id", "user_id",
    "assigned_by", "status", "assigned_at", "created_at", "updated_at"
  ) VALUES (
    gen_random_uuid()::text, NEW."agency_id", NEW."successor_case_id", rcic_role_id,
    rcic_user_id, NEW."recorded_by_id", 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) ON CONFLICT ("agency_id", "case_id", "case_role_id", "user_id")
  DO UPDATE SET "status" = 'active', "assigned_by" = EXCLUDED."assigned_by", "assigned_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP;

  INSERT INTO "case_role_assignments" (
    "id", "agency_id", "case_id", "case_role_id", "user_id",
    "assigned_by", "status", "assigned_at", "created_at", "updated_at"
  ) VALUES (
    gen_random_uuid()::text, NEW."agency_id", NEW."successor_case_id", worker_role_id,
    worker_user_id, NEW."recorded_by_id", 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ) ON CONFLICT ("agency_id", "case_id", "case_role_id", "user_id")
  DO UPDATE SET "status" = 'active', "assigned_by" = EXCLUDED."assigned_by", "assigned_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP;

  -- The Case Worker needs actual case access, not only attribution — RCIC
  -- already has it automatically as the case owner.
  IF rcic_user_id <> worker_user_id THEN
    INSERT INTO "case_assignments" (
      "id", "agency_id", "case_id", "consultant_user_id", "assignment_type",
      "status", "assigned_by", "assigned_at", "created_at", "updated_at"
    ) VALUES (
      gen_random_uuid()::text, NEW."agency_id", NEW."successor_case_id", worker_user_id,
      'supporting', 'active', NEW."recorded_by_id", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    ) ON CONFLICT ("agency_id", "case_id", "consultant_user_id", "assignment_type")
    DO UPDATE SET "status" = 'active', "assigned_by" = EXCLUDED."assigned_by", "assigned_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP;
  END IF;

  -- Preserve any additional supporting collaborators from the refused file.
  INSERT INTO "case_assignments" (
    "id", "agency_id", "case_id", "consultant_user_id", "assignment_type",
    "status", "assigned_by", "assigned_at", "created_at", "updated_at"
  )
  SELECT
    gen_random_uuid()::text,
    source."agency_id",
    NEW."successor_case_id",
    source."consultant_user_id",
    'supporting',
    'active',
    NEW."recorded_by_id",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  FROM "case_assignments" source
  WHERE source."agency_id" = NEW."agency_id"
    AND source."case_id" = NEW."case_id"
    AND source."assignment_type" = 'supporting'
    AND source."status" = 'active'
    AND source."consultant_user_id" <> rcic_user_id
  ON CONFLICT ("agency_id", "case_id", "consultant_user_id", "assignment_type")
  DO UPDATE SET "status" = 'active', "assigned_by" = EXCLUDED."assigned_by", "assigned_at" = CURRENT_TIMESTAMP, "updated_at" = CURRENT_TIMESTAMP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
