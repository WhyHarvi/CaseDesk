-- A Lead lives in the dedicated leads pipeline. Rows in clients with the
-- legacy Lead status are already real clients (they have CL numbers) and
-- became stranded when duplicate protection correctly refused to recreate
-- them. Genuine pre-conversion retainer/payment clients are linked through
-- leads.early_client_id and have always been Active.
UPDATE "clients"
SET "status" = 'Active'::"ClientStatus",
    "updated_at" = CURRENT_TIMESTAMP
WHERE "status" = 'Lead'::"ClientStatus";

-- Keep the old enum member temporarily for safe rolling deployment, but
-- make the invalid cross-pipeline state impossible from every write path,
-- including scripts or integrations that bypass the HTTP validation.
ALTER TABLE "clients"
ADD CONSTRAINT "clients_status_must_not_be_lead"
CHECK ("status" <> 'Lead'::"ClientStatus");
