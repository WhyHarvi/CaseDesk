-- Primary ownership is now the mandatory Case Worker role. Historical pending
-- self-service requests that asked for generic "primary" access must not be
-- able to bypass the required-team workflow when an admin reviews them.
UPDATE "case_collaboration_requests"
SET "requested_role" = 'supporting'
WHERE "status" = 'Pending'
  AND "requested_role" = 'primary';
