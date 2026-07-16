CREATE TYPE "CommunicationConversationState" AS ENUM ('Open', 'Waiting on Client', 'Waiting on Agency', 'Snoozed', 'Closed');
CREATE TYPE "CommunicationPriority" AS ENUM ('Low', 'Normal', 'High', 'Urgent');
CREATE TYPE "CommunicationOutboxStatus" AS ENUM ('Pending', 'Processing', 'Completed', 'Failed', 'Cancelled');
CREATE TYPE "CommunicationConsentStatus" AS ENUM ('Unknown', 'Consented', 'Opted Out');
CREATE TYPE "CommunicationAttachmentStatus" AS ENUM ('Pending', 'Clean', 'Rejected');

ALTER TYPE "CommunicationStatus" ADD VALUE 'Scheduled';
ALTER TYPE "CommunicationStatus" ADD VALUE 'Sending';
ALTER TYPE "CommunicationStatus" ADD VALUE 'Bounced';
ALTER TYPE "CommunicationStatus" ADD VALUE 'Blocked';
ALTER TYPE "CommunicationStatus" ADD VALUE 'OptedOut';
ALTER TYPE "CommunicationStatus" ADD VALUE 'Cancelled';

ALTER TABLE "communication_conversations"
  ADD COLUMN "assigned_to_id" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by_id" TEXT,
  ADD COLUMN "last_inbound_at" TIMESTAMP(3),
  ADD COLUMN "first_inbound_at" TIMESTAMP(3),
  ADD COLUMN "last_outbound_at" TIMESTAMP(3),
  ADD COLUMN "legal_hold" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "priority" "CommunicationPriority" NOT NULL DEFAULT 'Normal',
  ADD COLUMN "snoozed_until" TIMESTAMP(3),
  ADD COLUMN "response_due_at" TIMESTAMP(3),
  ADD COLUMN "resolution_due_at" TIMESTAMP(3),
  ADD COLUMN "first_responded_at" TIMESTAMP(3),
  ADD COLUMN "state" "CommunicationConversationState" NOT NULL DEFAULT 'Open',
  ADD COLUMN "tags" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "unread_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "communication_messages"
  ADD COLUMN "cc" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "bcc" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "call_recording_url" TEXT,
  ADD COLUMN "call_transcript" TEXT,
  ADD COLUMN "reply_to" TEXT,
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by_id" TEXT,
  ADD COLUMN "delivered_at" TIMESTAMP(3),
  ADD COLUMN "email_in_reply_to" TEXT,
  ADD COLUMN "email_message_id" TEXT,
  ADD COLUMN "email_references" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "failed_at" TIMESTAMP(3),
  ADD COLUMN "failure_reason" TEXT,
  ADD COLUMN "idempotency_key" TEXT,
  ADD COLUMN "parent_message_id" TEXT,
  ADD COLUMN "scheduled_at" TIMESTAMP(3),
  ADD COLUMN "sent_at" TIMESTAMP(3);

ALTER TABLE "agency_mail_settings"
  ADD COLUMN "imap_host" TEXT,
  ADD COLUMN "imap_port" INTEGER,
  ADD COLUMN "imap_secure" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "imap_username" TEXT,
  ADD COLUMN "imap_password_encrypted" TEXT,
  ADD COLUMN "inbound_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "last_synced_uid" BIGINT,
  ADD COLUMN "last_inbound_sync_at" TIMESTAMP(3),
  ADD COLUMN "last_inbound_sync_status" TEXT,
  ADD COLUMN "last_inbound_sync_message" TEXT;

ALTER TABLE "agency_ooma_settings"
  ADD COLUMN "webhook_token_encrypted" TEXT,
  ADD COLUMN "webhook_token_hash" TEXT,
  ADD COLUMN "last_webhook_at" TIMESTAMP(3);
CREATE UNIQUE INDEX "agency_ooma_settings_webhook_token_hash_key" ON "agency_ooma_settings"("webhook_token_hash");

UPDATE "communication_conversations" AS conversation
SET "assigned_to_id" = COALESCE(case_record."assigned_user_id", conversation."created_by_id")
FROM "cases" AS case_record
WHERE case_record."id" = conversation."case_id" AND conversation."assigned_to_id" IS NULL;

UPDATE "communication_conversations" AS conversation
SET
  "last_inbound_at" = activity."last_inbound_at",
  "first_inbound_at" = activity."first_inbound_at",
  "last_outbound_at" = activity."last_outbound_at",
  "unread_count" = activity."unread_count",
  "state" = CASE WHEN activity."latest_direction" = 'Inbound' THEN 'Waiting on Agency'::"CommunicationConversationState" WHEN activity."latest_direction" = 'Outbound' THEN 'Waiting on Client'::"CommunicationConversationState" ELSE conversation."state" END
FROM (
  SELECT
    thread."conversation_id",
    MAX(thread."occurred_at") FILTER (WHERE thread."direction" = 'Inbound') AS "last_inbound_at",
    MIN(thread."occurred_at") FILTER (WHERE thread."direction" = 'Inbound') AS "first_inbound_at",
    MAX(thread."occurred_at") FILTER (WHERE thread."direction" = 'Outbound') AS "last_outbound_at",
    COUNT(*) FILTER (WHERE thread."direction" = 'Inbound' AND thread."is_read" = false)::INTEGER AS "unread_count",
    (ARRAY_AGG(thread."direction" ORDER BY thread."occurred_at" DESC))[1] AS "latest_direction"
  FROM "communication_messages" AS thread
  GROUP BY thread."conversation_id"
) AS activity
WHERE activity."conversation_id" = conversation."id";

UPDATE "communication_conversations" AS conversation
SET "first_responded_at" = response."first_responded_at"
FROM (
  SELECT inbound."conversation_id", MIN(outbound."occurred_at") AS "first_responded_at"
  FROM "communication_messages" AS inbound
  JOIN "communication_messages" AS outbound
    ON outbound."conversation_id" = inbound."conversation_id"
    AND outbound."direction" = 'Outbound'
    AND outbound."occurred_at" >= inbound."occurred_at"
  WHERE inbound."direction" = 'Inbound'
  GROUP BY inbound."conversation_id"
) AS response
WHERE response."conversation_id" = conversation."id";

UPDATE "communication_conversations"
SET "resolution_due_at" = "created_at" + INTERVAL '48 hours'
WHERE "state" <> 'Closed';

CREATE TABLE "communication_delivery_events" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "provider_event_id" TEXT,
  "provider_timestamp" TIMESTAMP(3),
  "details" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "communication_delivery_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_outbox" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "operation" TEXT NOT NULL DEFAULT 'send',
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" "CommunicationOutboxStatus" NOT NULL DEFAULT 'Pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_outbox_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_permissions" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "can_view" BOOLEAN NOT NULL DEFAULT true,
  "can_send_email" BOOLEAN NOT NULL DEFAULT true,
  "can_send_sms" BOOLEAN NOT NULL DEFAULT true,
  "can_use_chat" BOOLEAN NOT NULL DEFAULT true,
  "can_initiate_calls" BOOLEAN NOT NULL DEFAULT true,
  "can_export" BOOLEAN NOT NULL DEFAULT false,
  "can_delete" BOOLEAN NOT NULL DEFAULT false,
  "can_manage_consent" BOOLEAN NOT NULL DEFAULT false,
  "can_manage_templates" BOOLEAN NOT NULL DEFAULT false,
  "can_manage_providers" BOOLEAN NOT NULL DEFAULT false,
  "can_view_all" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_permissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_consents" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "channel" "CommunicationChannel" NOT NULL,
  "address" TEXT NOT NULL,
  "status" "CommunicationConsentStatus" NOT NULL DEFAULT 'Unknown',
  "source" TEXT,
  "purpose" TEXT,
  "proof" JSONB NOT NULL DEFAULT '{}',
  "consented_at" TIMESTAMP(3),
  "opted_out_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_consents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_templates" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "channel" "CommunicationChannel" NOT NULL,
  "name" TEXT NOT NULL,
  "subject" TEXT,
  "body_text" TEXT NOT NULL,
  "body_html" TEXT,
  "category" TEXT,
  "language" TEXT NOT NULL DEFAULT 'English',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" TEXT NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_attachments" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "storage_key" TEXT NOT NULL,
  "original_filename" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "file_hash" TEXT NOT NULL,
  "scan_status" "CommunicationAttachmentStatus" NOT NULL DEFAULT 'Pending',
  "scan_details" TEXT,
  "uploaded_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "communication_attachments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "unmatched_communications" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "channel" "CommunicationChannel" NOT NULL,
  "provider" TEXT NOT NULL,
  "provider_message_id" TEXT,
  "sender_address" TEXT,
  "recipients" JSONB NOT NULL DEFAULT '[]',
  "subject" TEXT,
  "body_text" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "raw_payload" JSONB NOT NULL DEFAULT '{}',
  "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "unmatched_communications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_audit_events" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "user_id" TEXT,
  "conversation_id" TEXT,
  "message_id" TEXT,
  "action" TEXT NOT NULL,
  "details" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "communication_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_retention_policies" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "retention_days" INTEGER NOT NULL DEFAULT 2555,
  "trash_days" INTEGER NOT NULL DEFAULT 30,
  "allow_staff_delete" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_retention_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_preferences" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "preferred_channel" "CommunicationChannel",
  "language" TEXT NOT NULL DEFAULT 'English',
  "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
  "quiet_hours_start" TEXT,
  "quiet_hours_end" TEXT,
  "allow_email" BOOLEAN NOT NULL DEFAULT true,
  "allow_sms" BOOLEAN NOT NULL DEFAULT true,
  "allow_chat" BOOLEAN NOT NULL DEFAULT true,
  "allow_calls" BOOLEAN NOT NULL DEFAULT true,
  "do_not_contact" BOOLEAN NOT NULL DEFAULT false,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_preferences_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_automation_rules" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "channel" "CommunicationChannel",
  "conditions" JSONB NOT NULL DEFAULT '{}',
  "actions" JSONB NOT NULL DEFAULT '{}',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "last_run_at" TIMESTAMP(3),
  "run_count" INTEGER NOT NULL DEFAULT 0,
  "created_by_id" TEXT NOT NULL,
  "updated_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_automation_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_sla_policies" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "first_response_minutes" INTEGER NOT NULL DEFAULT 240,
  "resolution_hours" INTEGER NOT NULL DEFAULT 48,
  "business_hours_only" BOOLEAN NOT NULL DEFAULT false,
  "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
  "business_hours_start" TEXT NOT NULL DEFAULT '09:00',
  "business_hours_end" TEXT NOT NULL DEFAULT '17:00',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_sla_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "client_communication_accesses" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "last_used_at" TIMESTAMP(3),
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_communication_accesses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "communication_delivery_events_message_id_created_at_idx" ON "communication_delivery_events"("message_id", "created_at");
CREATE INDEX "communication_delivery_events_agency_id_type_idx" ON "communication_delivery_events"("agency_id", "type");
CREATE UNIQUE INDEX "communication_delivery_events_agency_id_provider_event_id_key" ON "communication_delivery_events"("agency_id", "provider_event_id");
CREATE INDEX "communication_outbox_status_available_at_idx" ON "communication_outbox"("status", "available_at");
CREATE INDEX "communication_outbox_message_id_idx" ON "communication_outbox"("message_id");
CREATE UNIQUE INDEX "communication_permissions_user_id_key" ON "communication_permissions"("user_id");
CREATE INDEX "communication_permissions_agency_id_idx" ON "communication_permissions"("agency_id");
CREATE INDEX "communication_consents_client_id_channel_idx" ON "communication_consents"("client_id", "channel");
CREATE INDEX "communication_consents_agency_id_status_idx" ON "communication_consents"("agency_id", "status");
CREATE UNIQUE INDEX "communication_consents_agency_id_channel_address_key" ON "communication_consents"("agency_id", "channel", "address");
CREATE INDEX "communication_templates_agency_id_channel_is_active_idx" ON "communication_templates"("agency_id", "channel", "is_active");
CREATE UNIQUE INDEX "communication_templates_agency_id_name_key" ON "communication_templates"("agency_id", "name");
CREATE INDEX "communication_attachments_message_id_idx" ON "communication_attachments"("message_id");
CREATE INDEX "communication_attachments_agency_id_scan_status_idx" ON "communication_attachments"("agency_id", "scan_status");
CREATE INDEX "unmatched_communications_agency_id_resolved_at_occurred_at_idx" ON "unmatched_communications"("agency_id", "resolved_at", "occurred_at");
CREATE UNIQUE INDEX "unmatched_communications_agency_id_provider_provider_messag_key" ON "unmatched_communications"("agency_id", "provider", "provider_message_id");
CREATE INDEX "communication_audit_events_agency_id_created_at_idx" ON "communication_audit_events"("agency_id", "created_at");
CREATE INDEX "communication_audit_events_conversation_id_created_at_idx" ON "communication_audit_events"("conversation_id", "created_at");
CREATE INDEX "communication_audit_events_message_id_created_at_idx" ON "communication_audit_events"("message_id", "created_at");
CREATE UNIQUE INDEX "communication_retention_policies_agency_id_key" ON "communication_retention_policies"("agency_id");
CREATE UNIQUE INDEX "communication_preferences_client_id_key" ON "communication_preferences"("client_id");
CREATE INDEX "communication_preferences_agency_id_do_not_contact_idx" ON "communication_preferences"("agency_id", "do_not_contact");
CREATE UNIQUE INDEX "communication_automation_rules_agency_id_name_key" ON "communication_automation_rules"("agency_id", "name");
CREATE INDEX "communication_automation_rules_agency_id_trigger_is_active_idx" ON "communication_automation_rules"("agency_id", "trigger", "is_active");
CREATE UNIQUE INDEX "communication_sla_policies_agency_id_key" ON "communication_sla_policies"("agency_id");
CREATE UNIQUE INDEX "client_communication_accesses_token_hash_key" ON "client_communication_accesses"("token_hash");
CREATE INDEX "client_communication_accesses_agency_id_case_id_revoked_at_idx" ON "client_communication_accesses"("agency_id", "case_id", "revoked_at");
CREATE INDEX "client_communication_accesses_expires_at_idx" ON "client_communication_accesses"("expires_at");
CREATE INDEX "communication_conversations_agency_id_state_last_message_at_idx" ON "communication_conversations"("agency_id", "state", "last_message_at");
CREATE INDEX "communication_conversations_assigned_to_id_state_idx" ON "communication_conversations"("assigned_to_id", "state");
CREATE INDEX "communication_conversations_agency_id_response_due_at_state_idx" ON "communication_conversations"("agency_id", "response_due_at", "state");
CREATE INDEX "communication_conversations_agency_id_resolution_due_at_state_idx" ON "communication_conversations"("agency_id", "resolution_due_at", "state");
CREATE INDEX "communication_conversations_deleted_at_idx" ON "communication_conversations"("deleted_at");
CREATE INDEX "communication_messages_scheduled_at_status_idx" ON "communication_messages"("scheduled_at", "status");
CREATE INDEX "communication_messages_deleted_at_idx" ON "communication_messages"("deleted_at");
CREATE UNIQUE INDEX "communication_messages_agency_id_idempotency_key_key" ON "communication_messages"("agency_id", "idempotency_key");
CREATE UNIQUE INDEX "communication_messages_agency_id_provider_provider_message__key" ON "communication_messages"("agency_id", "provider", "provider_message_id");

ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_deleted_by_id_fkey" FOREIGN KEY ("deleted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_parent_message_id_fkey" FOREIGN KEY ("parent_message_id") REFERENCES "communication_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "communication_delivery_events" ADD CONSTRAINT "communication_delivery_events_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_delivery_events" ADD CONSTRAINT "communication_delivery_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "communication_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_outbox" ADD CONSTRAINT "communication_outbox_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_outbox" ADD CONSTRAINT "communication_outbox_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "communication_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_permissions" ADD CONSTRAINT "communication_permissions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_permissions" ADD CONSTRAINT "communication_permissions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_consents" ADD CONSTRAINT "communication_consents_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_consents" ADD CONSTRAINT "communication_consents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_templates" ADD CONSTRAINT "communication_templates_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_templates" ADD CONSTRAINT "communication_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "communication_templates" ADD CONSTRAINT "communication_templates_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "communication_attachments" ADD CONSTRAINT "communication_attachments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_attachments" ADD CONSTRAINT "communication_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "communication_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_attachments" ADD CONSTRAINT "communication_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "unmatched_communications" ADD CONSTRAINT "unmatched_communications_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_audit_events" ADD CONSTRAINT "communication_audit_events_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_audit_events" ADD CONSTRAINT "communication_audit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "communication_retention_policies" ADD CONSTRAINT "communication_retention_policies_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_automation_rules" ADD CONSTRAINT "communication_automation_rules_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_automation_rules" ADD CONSTRAINT "communication_automation_rules_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "communication_automation_rules" ADD CONSTRAINT "communication_automation_rules_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "communication_sla_policies" ADD CONSTRAINT "communication_sla_policies_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_communication_accesses" ADD CONSTRAINT "client_communication_accesses_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_communication_accesses" ADD CONSTRAINT "client_communication_accesses_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_communication_accesses" ADD CONSTRAINT "client_communication_accesses_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_communication_accesses" ADD CONSTRAINT "client_communication_accesses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'realtime') THEN
    BEGIN
      CREATE POLICY "casedesk_private_case_chat_read" ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        realtime.topic() = 'case:' || (current_setting('request.jwt.claims', true)::jsonb ->> 'agency_id') || ':' || (current_setting('request.jwt.claims', true)::jsonb ->> 'case_id')
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      CREATE POLICY "casedesk_private_case_chat_write" ON realtime.messages
      FOR INSERT TO authenticated
      WITH CHECK (
        realtime.topic() = 'case:' || (current_setting('request.jwt.claims', true)::jsonb ->> 'agency_id') || ':' || (current_setting('request.jwt.claims', true)::jsonb ->> 'case_id')
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
