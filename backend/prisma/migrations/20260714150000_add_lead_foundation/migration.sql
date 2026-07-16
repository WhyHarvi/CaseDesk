-- Source-agnostic lead foundation. External connectors intentionally belong to later phases.

CREATE TYPE "LeadStatus" AS ENUM ('OPEN', 'CONVERTED', 'LOST', 'NURTURE', 'DUPLICATE', 'DO_NOT_CONTACT', 'ARCHIVED');
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'ASSIGNED', 'CONTACTING', 'CONNECTED', 'QUALIFIED', 'CONSULTATION_BOOKED', 'CONSULTATION_COMPLETED', 'RETAINER_PENDING', 'PAYMENT_PENDING', 'READY_TO_CONVERT');
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "LeadTemperature" AS ENUM ('COLD', 'WARM', 'HOT');
CREATE TYPE "LeadSourceType" AS ENUM ('PHONE', 'OOMA', 'WHATSAPP', 'FACEBOOK', 'INSTAGRAM', 'SOCIAL_FORM', 'SOCIAL_MESSAGE', 'WEBSITE', 'GOOGLE_ADS', 'EMAIL', 'WALK_IN', 'REFERRAL', 'EVENT', 'EMPLOYEE_PHONE', 'CSV_IMPORT', 'OTHER');
CREATE TYPE "LeadActivityType" AS ENUM ('LEAD_CREATED', 'INCOMING_CALL', 'OUTGOING_CALL', 'MISSED_CALL', 'WHATSAPP_RECEIVED', 'WHATSAPP_SENT', 'SMS_RECEIVED', 'SMS_SENT', 'EMAIL_RECEIVED', 'EMAIL_SENT', 'INTERNAL_NOTE', 'STAGE_CHANGED', 'ASSIGNMENT_CHANGED', 'FOLLOW_UP_CREATED', 'FOLLOW_UP_COMPLETED', 'CONSULTATION_BOOKED', 'CONSULTATION_RESCHEDULED', 'CONSULTATION_COMPLETED', 'CONSULTATION_CANCELLED', 'CONSULTATION_NO_SHOW', 'AGREEMENT_PREPARED', 'AGREEMENT_SENT', 'AGREEMENT_SIGNED', 'PAYMENT_REQUESTED', 'PAYMENT_RECEIVED', 'LEAD_CONVERTED', 'LEAD_LOST', 'LEAD_MOVED_TO_NURTURE', 'LEAD_REACTIVATED', 'LEAD_MERGED');
CREATE TYPE "LeadActivityDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');
CREATE TYPE "LeadActivityChannel" AS ENUM ('PHONE', 'OOMA', 'WHATSAPP', 'SMS', 'EMAIL', 'SOCIAL', 'WEBSITE', 'IN_PERSON', 'SYSTEM', 'OTHER');
CREATE TYPE "LeadFollowUpStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');
CREATE TYPE "LeadAssignmentType" AS ENUM ('MANUAL', 'ROUND_ROBIN', 'RULE_BASED', 'REASSIGNMENT', 'SYSTEM');
CREATE TYPE "LeadLostReason" AS ENUM ('NO_RESPONSE', 'NOT_INTERESTED', 'NOT_ELIGIBLE', 'PRICE_CONCERN', 'SELECTED_ANOTHER_CONSULTANT', 'CONSULTATION_NO_SHOW', 'AGREEMENT_NOT_SIGNED', 'PAYMENT_NOT_COMPLETED', 'SERVICE_NOT_OFFERED', 'WRONG_CONTACT_INFORMATION', 'DUPLICATE', 'DO_NOT_CONTACT', 'OTHER');
CREATE TYPE "LeadRetainerStatus" AS ENUM ('NOT_REQUIRED', 'NOT_PREPARED', 'PREPARED', 'SENT', 'VIEWED', 'SIGNED', 'DECLINED', 'EXPIRED');
CREATE TYPE "LeadInitialPaymentStatus" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'PARTIAL', 'PAID', 'FAILED', 'REFUNDED', 'WAIVED');

CREATE TABLE "agency_lead_sequences" (
  "agency_id" TEXT PRIMARY KEY REFERENCES "agencies"("id") ON DELETE CASCADE,
  "next_value" INTEGER NOT NULL DEFAULT 1,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "lead_sources" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "type" "LeadSourceType" NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "lead_sources_agency_id_name_key" ON "lead_sources"("agency_id", "name");
CREATE INDEX "lead_sources_agency_id_type_is_active_idx" ON "lead_sources"("agency_id", "type", "is_active");

CREATE TABLE "lead_campaigns" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "source_id" TEXT NOT NULL REFERENCES "lead_sources"("id") ON DELETE RESTRICT,
  "name" TEXT NOT NULL,
  "external_id" TEXT,
  "start_date" TIMESTAMP(3),
  "end_date" TIMESTAMP(3),
  "budget" DECIMAL(12,2),
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "lead_campaigns_agency_id_source_id_name_key" ON "lead_campaigns"("agency_id", "source_id", "name");
CREATE INDEX "lead_campaigns_agency_id_is_active_idx" ON "lead_campaigns"("agency_id", "is_active");
CREATE INDEX "lead_campaigns_source_id_idx" ON "lead_campaigns"("source_id");

CREATE TABLE "leads" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "lead_number" TEXT NOT NULL,
  "first_name" TEXT,
  "last_name" TEXT,
  "phone" TEXT NOT NULL,
  "phone_normalized" TEXT NOT NULL,
  "email" TEXT,
  "email_normalized" TEXT,
  "country" TEXT,
  "province" TEXT,
  "preferred_language" TEXT,
  "current_immigration_status" TEXT,
  "immigration_interest" TEXT,
  "status" "LeadStatus" NOT NULL DEFAULT 'OPEN',
  "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
  "priority" "LeadPriority" NOT NULL DEFAULT 'NORMAL',
  "temperature" "LeadTemperature" NOT NULL DEFAULT 'COLD',
  "owner_user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "original_source_id" TEXT NOT NULL REFERENCES "lead_sources"("id") ON DELETE RESTRICT,
  "campaign_id" TEXT REFERENCES "lead_campaigns"("id") ON DELETE SET NULL,
  "initial_message" TEXT,
  "estimated_value" DECIMAL(12,2),
  "next_action_type" TEXT,
  "next_action_description" TEXT,
  "next_action_at" TIMESTAMP(3),
  "next_action_owner_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "first_contact_due_at" TIMESTAMP(3),
  "first_contact_at" TIMESTAMP(3),
  "first_connected_at" TIMESTAMP(3),
  "last_contact_at" TIMESTAMP(3),
  "retainer_status" "LeadRetainerStatus" NOT NULL DEFAULT 'NOT_PREPARED',
  "initial_payment_status" "LeadInitialPaymentStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "converted_client_id" TEXT UNIQUE REFERENCES "clients"("id") ON DELETE SET NULL,
  "converted_case_id" TEXT UNIQUE REFERENCES "cases"("id") ON DELETE SET NULL,
  "converted_at" TIMESTAMP(3),
  "lost_at" TIMESTAMP(3),
  "nurture_until" TIMESTAMP(3),
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  CONSTRAINT "leads_open_next_action_check" CHECK (
    "status" <> 'OPEN' OR (
      "next_action_type" IS NOT NULL AND
      "next_action_description" IS NOT NULL AND
      "next_action_at" IS NOT NULL AND
      "next_action_owner_id" IS NOT NULL
    )
  )
);
CREATE UNIQUE INDEX "leads_agency_id_lead_number_key" ON "leads"("agency_id", "lead_number");
CREATE INDEX "leads_agency_id_status_idx" ON "leads"("agency_id", "status");
CREATE INDEX "leads_agency_id_stage_idx" ON "leads"("agency_id", "stage");
CREATE INDEX "leads_agency_id_owner_user_id_idx" ON "leads"("agency_id", "owner_user_id");
CREATE INDEX "leads_agency_id_next_action_at_idx" ON "leads"("agency_id", "next_action_at");
CREATE INDEX "leads_agency_id_created_at_idx" ON "leads"("agency_id", "created_at");
CREATE INDEX "leads_agency_id_phone_normalized_idx" ON "leads"("agency_id", "phone_normalized");
CREATE INDEX "leads_agency_id_email_normalized_idx" ON "leads"("agency_id", "email_normalized");
CREATE INDEX "leads_agency_id_original_source_id_idx" ON "leads"("agency_id", "original_source_id");
CREATE INDEX "leads_agency_id_campaign_id_idx" ON "leads"("agency_id", "campaign_id");

CREATE TABLE "lead_activities" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "lead_id" TEXT NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "activity_type" "LeadActivityType" NOT NULL,
  "direction" "LeadActivityDirection",
  "channel" "LeadActivityChannel",
  "outcome" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "duration_seconds" INTEGER,
  "performed_by" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "external_id" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "lead_activities_agency_id_lead_id_occurred_at_idx" ON "lead_activities"("agency_id", "lead_id", "occurred_at");
CREATE INDEX "lead_activities_agency_id_activity_type_occurred_at_idx" ON "lead_activities"("agency_id", "activity_type", "occurred_at");

CREATE TABLE "lead_stage_history" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "lead_id" TEXT NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "previous_stage" "LeadStage",
  "new_stage" "LeadStage" NOT NULL,
  "changed_by" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "lead_stage_history_agency_id_lead_id_created_at_idx" ON "lead_stage_history"("agency_id", "lead_id", "created_at");

CREATE TABLE "lead_assignment_history" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "lead_id" TEXT NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "previous_owner_id" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "new_owner_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "assigned_by" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "assignment_type" "LeadAssignmentType" NOT NULL DEFAULT 'MANUAL',
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "lead_assignment_history_agency_id_lead_id_created_at_idx" ON "lead_assignment_history"("agency_id", "lead_id", "created_at");
CREATE INDEX "lead_assignment_history_agency_id_new_owner_id_created_at_idx" ON "lead_assignment_history"("agency_id", "new_owner_id", "created_at");

CREATE TABLE "lead_follow_ups" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "lead_id" TEXT NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "assigned_user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "type" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "due_at" TIMESTAMP(3) NOT NULL,
  "status" "LeadFollowUpStatus" NOT NULL DEFAULT 'PENDING',
  "completed_at" TIMESTAMP(3),
  "completed_by" TEXT REFERENCES "users"("id") ON DELETE SET NULL,
  "completion_outcome" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "lead_follow_ups_agency_id_assigned_user_id_status_due_at_idx" ON "lead_follow_ups"("agency_id", "assigned_user_id", "status", "due_at");
CREATE INDEX "lead_follow_ups_agency_id_lead_id_due_at_idx" ON "lead_follow_ups"("agency_id", "lead_id", "due_at");

CREATE TABLE "lead_lost_details" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "lead_id" TEXT NOT NULL UNIQUE REFERENCES "leads"("id") ON DELETE CASCADE,
  "reason_code" "LeadLostReason" NOT NULL,
  "notes" TEXT,
  "lost_by" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "last_contact_at" TIMESTAMP(3),
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "reactivation_allowed" BOOLEAN NOT NULL DEFAULT false,
  "reactivation_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "lead_lost_details_agency_id_reason_code_created_at_idx" ON "lead_lost_details"("agency_id", "reason_code", "created_at");

CREATE TABLE "lead_conversions" (
  "id" TEXT PRIMARY KEY,
  "agency_id" TEXT NOT NULL REFERENCES "agencies"("id") ON DELETE CASCADE,
  "lead_id" TEXT NOT NULL UNIQUE REFERENCES "leads"("id") ON DELETE RESTRICT,
  "client_id" TEXT NOT NULL REFERENCES "clients"("id") ON DELETE RESTRICT,
  "case_id" TEXT REFERENCES "cases"("id") ON DELETE SET NULL,
  "converted_by" TEXT NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "estimated_value" DECIMAL(12,2),
  "actual_value" DECIMAL(12,2),
  "converted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "lead_conversions_agency_id_converted_at_idx" ON "lead_conversions"("agency_id", "converted_at");
CREATE INDEX "lead_conversions_client_id_idx" ON "lead_conversions"("client_id");
CREATE INDEX "lead_conversions_case_id_idx" ON "lead_conversions"("case_id");

-- Timeline and history rows are append-only. Cascading deletes remain possible for agency removal.
CREATE OR REPLACE FUNCTION public.reject_lead_history_update() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'lead history is append-only'; END; $$;
CREATE TRIGGER lead_activities_no_update BEFORE UPDATE ON "lead_activities" FOR EACH ROW EXECUTE FUNCTION public.reject_lead_history_update();
CREATE TRIGGER lead_stage_history_no_update BEFORE UPDATE ON "lead_stage_history" FOR EACH ROW EXECUTE FUNCTION public.reject_lead_history_update();
CREATE TRIGGER lead_assignment_history_no_update BEFORE UPDATE ON "lead_assignment_history" FOR EACH ROW EXECUTE FUNCTION public.reject_lead_history_update();

ALTER TABLE "agency_lead_sequences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_activities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_stage_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_assignment_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_follow_ups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_lost_details" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lead_conversions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY lead_sequence_admin ON "agency_lead_sequences" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin')
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
CREATE POLICY lead_sources_read ON "lead_sources" FOR SELECT TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY lead_sources_admin ON "lead_sources" FOR ALL TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin') WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');
CREATE POLICY lead_campaigns_read ON "lead_campaigns" FOR SELECT TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY lead_campaigns_admin ON "lead_campaigns" FOR ALL TO authenticated USING ("agency_id" = current_agency_id() AND current_user_role() = 'admin') WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() = 'admin');

CREATE POLICY leads_read ON "leads" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR (current_user_role() = 'consultant' AND "owner_user_id" = current_app_user_id()))
);
CREATE POLICY leads_insert ON "leads" FOR INSERT TO authenticated WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY leads_update ON "leads" FOR UPDATE TO authenticated
  USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR "owner_user_id" = current_app_user_id()))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));

CREATE POLICY lead_activities_read ON "lead_activities" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND EXISTS (SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND (current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id()))
);
CREATE POLICY lead_activities_insert ON "lead_activities" FOR INSERT TO authenticated WITH CHECK (
  "agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant') AND EXISTS (SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND l."agency_id" = current_agency_id())
);
CREATE POLICY lead_stage_history_read ON "lead_stage_history" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND EXISTS (SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND (current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id()))
);
CREATE POLICY lead_stage_history_insert ON "lead_stage_history" FOR INSERT TO authenticated WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY lead_assignment_history_read ON "lead_assignment_history" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND EXISTS (SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND (current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id()))
);
CREATE POLICY lead_assignment_history_insert ON "lead_assignment_history" FOR INSERT TO authenticated WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY lead_follow_ups_access ON "lead_follow_ups" FOR ALL TO authenticated
  USING ("agency_id" = current_agency_id() AND (current_user_role() = 'admin' OR "assigned_user_id" = current_app_user_id()))
  WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY lead_lost_details_read ON "lead_lost_details" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND EXISTS (SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND (current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id()))
);
CREATE POLICY lead_lost_details_insert ON "lead_lost_details" FOR INSERT TO authenticated WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
CREATE POLICY lead_conversions_read ON "lead_conversions" FOR SELECT TO authenticated USING (
  "agency_id" = current_agency_id() AND EXISTS (SELECT 1 FROM "leads" l WHERE l.id = "lead_id" AND (current_user_role() = 'admin' OR l."owner_user_id" = current_app_user_id()))
);
CREATE POLICY lead_conversions_insert ON "lead_conversions" FOR INSERT TO authenticated WITH CHECK ("agency_id" = current_agency_id() AND current_user_role() IN ('admin','consultant'));
