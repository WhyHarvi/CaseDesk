-- Automatic matching can mark a staged Case Easy contact as converted to an
-- existing Client without copying that relationship onto report rows already
-- linked to the contact. Backfill only missing links; an explicit existing
-- report-row client link is never overwritten.
UPDATE "case_easy_import_report_rows" AS report
SET
  "linked_client_id" = contact."converted_client_id",
  "updated_at" = CURRENT_TIMESTAMP
FROM "case_easy_import_contacts" AS contact
WHERE report."agency_id" = contact."agency_id"
  AND report."linked_contact_id" = contact."id"
  AND report."linked_client_id" IS NULL
  AND contact."converted_client_id" IS NOT NULL;
