CREATE UNIQUE INDEX "case_collaboration_requests_one_pending_per_user_case"
ON "case_collaboration_requests"("agency_id", "case_id", "requested_by_id")
WHERE "status" = 'Pending';
