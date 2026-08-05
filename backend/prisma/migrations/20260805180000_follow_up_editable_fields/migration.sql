ALTER TABLE "follow_ups"
  ADD COLUMN "follow_up_type" TEXT NOT NULL DEFAULT 'General follow-up',
  ADD COLUMN "priority" TEXT NOT NULL DEFAULT 'Medium';

-- Preserve the classifications users were seeing before these values became
-- editable. Previously the frontend inferred both fields from the title,
-- notes, status, and due date every time the page loaded.
UPDATE "follow_ups"
SET "follow_up_type" = CASE
  WHEN CONCAT_WS(' ', "title", "description") ~* '(payment|balance|fee)' THEN 'Payment reminder'
  WHEN CONCAT_WS(' ', "title", "description") ~* '(document|passport|certificate|missing|upload)' THEN 'Document request'
  WHEN CONCAT_WS(' ', "title", "description") ~* '(call|phone|consult)' THEN 'Client call'
  ELSE 'General follow-up'
END,
"priority" = CASE
  WHEN CONCAT_WS(' ', "title", "description") ~* '(urgent|missing|passport|certificate)'
    OR ("status" NOT IN ('Completed', 'Cancelled') AND ("status" = 'Overdue' OR "due_date" < CURRENT_DATE))
    THEN 'High'
  WHEN CONCAT_WS(' ', "title", "description") ~* '(payment|document|review|submit)'
    OR ("status" NOT IN ('Completed', 'Cancelled') AND "due_date" >= CURRENT_DATE AND "due_date" < CURRENT_DATE + INTERVAL '1 day')
    THEN 'Medium'
  ELSE 'Low'
END;

-- Repair older case-linked records that were created without copying the
-- case's client relation. This keeps the editor and client-level reporting
-- consistent without changing which case the follow-up belongs to.
UPDATE "follow_ups" AS follow_up
SET "client_id" = case_record."client_id"
FROM "cases" AS case_record
WHERE follow_up."case_id" = case_record."id"
  AND follow_up."client_id" IS NULL;

ALTER TABLE "follow_ups"
  ADD CONSTRAINT "follow_ups_priority_check"
    CHECK ("priority" IN ('High', 'Medium', 'Low')),
  ADD CONSTRAINT "follow_ups_type_check"
    CHECK ("follow_up_type" IN ('General follow-up', 'Client call', 'Document request', 'Payment reminder', 'Case review'));
