-- Case-level activity rows were historically allowed to omit client_id.
-- That made them visible on the case audit trail but invisible from the
-- client's combined activity timeline. Link every existing case activity
-- back to the owning client so the client profile can show a complete audit.
UPDATE "activity_logs" AS activity
SET "client_id" = cases."client_id"
FROM "cases" AS cases
WHERE activity."case_id" = cases."id"
  AND activity."agency_id" = cases."agency_id"
  AND activity."client_id" IS NULL;
