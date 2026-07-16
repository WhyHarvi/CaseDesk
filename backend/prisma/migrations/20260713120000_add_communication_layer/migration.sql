CREATE TYPE "CommunicationChannel" AS ENUM ('Email', 'Sms', 'Chat', 'Call');
CREATE TYPE "CommunicationDirection" AS ENUM ('Inbound', 'Outbound', 'Internal');
CREATE TYPE "CommunicationStatus" AS ENUM ('Draft', 'Queued', 'Sent', 'Delivered', 'Failed', 'Received', 'Completed', 'Missed');

CREATE TABLE "communication_conversations" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "channel" "CommunicationChannel" NOT NULL,
  "subject" TEXT,
  "provider" TEXT,
  "provider_thread_id" TEXT,
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "created_by_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_conversations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "communication_messages" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "channel" "CommunicationChannel" NOT NULL,
  "direction" "CommunicationDirection" NOT NULL,
  "status" "CommunicationStatus" NOT NULL,
  "sender_user_id" TEXT,
  "sender_address" TEXT,
  "recipients" JSONB NOT NULL DEFAULT '[]',
  "subject" TEXT,
  "body_text" TEXT,
  "body_html" TEXT,
  "provider" TEXT,
  "provider_message_id" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "duration_seconds" INTEGER,
  "call_disposition" TEXT,
  "attachments" JSONB NOT NULL DEFAULT '[]',
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "is_read" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "communication_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "communication_conversations_agency_id_idx" ON "communication_conversations"("agency_id");
CREATE INDEX "communication_conversations_case_id_last_message_at_idx" ON "communication_conversations"("case_id", "last_message_at");
CREATE INDEX "communication_conversations_client_id_idx" ON "communication_conversations"("client_id");
CREATE INDEX "communication_conversations_channel_idx" ON "communication_conversations"("channel");
CREATE INDEX "communication_messages_agency_id_idx" ON "communication_messages"("agency_id");
CREATE INDEX "communication_messages_case_id_occurred_at_idx" ON "communication_messages"("case_id", "occurred_at");
CREATE INDEX "communication_messages_conversation_id_occurred_at_idx" ON "communication_messages"("conversation_id", "occurred_at");
CREATE INDEX "communication_messages_client_id_idx" ON "communication_messages"("client_id");
CREATE INDEX "communication_messages_channel_idx" ON "communication_messages"("channel");
CREATE INDEX "communication_messages_status_idx" ON "communication_messages"("status");
CREATE INDEX "communication_messages_provider_message_id_idx" ON "communication_messages"("provider_message_id");

ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_conversations" ADD CONSTRAINT "communication_conversations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "communication_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_messages" ADD CONSTRAINT "communication_messages_sender_user_id_fkey" FOREIGN KEY ("sender_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
