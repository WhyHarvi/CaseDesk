CREATE TABLE "team_incentive_role_assignments" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "case_role_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "team_incentive_role_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_incentive_role_assignments_agency_id_case_role_id_user_id_key"
ON "team_incentive_role_assignments"("agency_id", "case_role_id", "user_id");
CREATE INDEX "team_incentive_role_assignments_agency_id_case_role_id_idx"
ON "team_incentive_role_assignments"("agency_id", "case_role_id");
CREATE INDEX "team_incentive_role_assignments_agency_id_user_id_idx"
ON "team_incentive_role_assignments"("agency_id", "user_id");

ALTER TABLE "team_incentive_role_assignments"
ADD CONSTRAINT "team_incentive_role_assignments_agency_id_fkey"
FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_incentive_role_assignments"
ADD CONSTRAINT "team_incentive_role_assignments_case_role_id_fkey"
FOREIGN KEY ("case_role_id") REFERENCES "agency_case_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_incentive_role_assignments"
ADD CONSTRAINT "team_incentive_role_assignments_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve the agency's existing choices while moving attribution to the
-- global team-member model. Repeated case assignments collapse to one row.
INSERT INTO "team_incentive_role_assignments" ("id", "agency_id", "case_role_id", "user_id", "created_at", "updated_at")
SELECT gen_random_uuid()::text, "agency_id", "case_role_id", "user_id", MIN("created_at"), CURRENT_TIMESTAMP
FROM "case_role_assignments"
WHERE "status" = 'active'
GROUP BY "agency_id", "case_role_id", "user_id"
ON CONFLICT ("agency_id", "case_role_id", "user_id") DO NOTHING;
