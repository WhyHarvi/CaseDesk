ALTER TABLE "notifications"
ADD COLUMN "destination_key" TEXT;

UPDATE "notifications"
SET "destination_key" = CASE
  WHEN "action_url" LIKE '/client-portal/documents%' THEN 'portalDocuments'
  WHEN "action_url" LIKE '/client-portal/questionnaires%' THEN 'portalForms'
  WHEN "action_url" LIKE '/client-portal/appointments%' THEN 'portalAppointments'
  WHEN "action_url" LIKE '/client-portal/payments%' THEN 'portalPayments'
  WHEN "action_url" LIKE '/client-portal/chat%' THEN 'portalChat'
  WHEN "action_url" = '/client-portal' OR "action_url" LIKE '/client-portal?%' THEN 'portalHome'
  WHEN "action_url" LIKE '/leads%' THEN 'leads'
  WHEN "action_url" LIKE '/lead-intake%' THEN 'leadIntake'
  WHEN "action_url" LIKE '/app/clients%' THEN 'clients'
  WHEN "action_url" LIKE '/app/follow-ups%' THEN 'followUps'
  WHEN "action_url" LIKE '/app/calendar%' THEN 'calendar'
  WHEN "action_url" LIKE '/app/documents%' THEN 'documents'
  WHEN "action_url" LIKE '/app/payments%' THEN 'payments'
  WHEN "action_url" LIKE '/app/case-easy-import%' THEN 'caseEasyImport'
  WHEN "action_url" LIKE '/app/settings%' THEN 'settings'
  WHEN "action_url" LIKE '/app/cases%' AND "category" = 'documents' THEN 'documents'
  WHEN "action_url" LIKE '/app/cases%' AND "category" = 'appointments' THEN 'calendar'
  WHEN "action_url" LIKE '/app/cases%' AND "category" = 'payments' THEN 'payments'
  WHEN "action_url" LIKE '/app/cases%' AND "category" = 'work' AND "type" LIKE 'follow_up.%' THEN 'followUps'
  WHEN "action_url" LIKE '/app/cases%' THEN 'cases'
  WHEN "category" = 'leads' THEN 'leads'
  WHEN "category" = 'appointments' THEN 'calendar'
  WHEN "category" = 'documents' THEN 'documents'
  WHEN "category" = 'questionnaires' THEN 'cases'
  WHEN "category" = 'security' THEN 'settings'
  WHEN "category" = 'communications' THEN 'cases'
  WHEN "category" = 'work' AND "type" LIKE 'follow_up.%' THEN 'followUps'
  ELSE 'cases'
END;

ALTER TABLE "notifications"
ALTER COLUMN "destination_key" SET DEFAULT 'cases',
ALTER COLUMN "destination_key" SET NOT NULL;

CREATE INDEX "notifications_recipient_user_id_destination_key_resolved_at_read_at_idx"
ON "notifications"("recipient_user_id", "destination_key", "resolved_at", "read_at");
