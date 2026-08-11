-- Staff-to-staff internal chat (DMs and group threads). New, purpose-built
-- tables rather than reusing communication_conversations/messages, which
-- are client-centric and don't model per-participant read state.

CREATE TABLE "internal_chat_threads" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "is_group" BOOLEAN NOT NULL DEFAULT false,
  "name" TEXT,
  "created_by_id" TEXT NOT NULL,
  "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "internal_chat_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "internal_chat_participants" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "last_read_at" TIMESTAMP(3),
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "internal_chat_participants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "internal_chat_messages" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL,
  "body_text" TEXT,
  "has_attachment" BOOLEAN NOT NULL DEFAULT false,
  "client_message_id" TEXT,
  "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "internal_chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "internal_chat_attachments" (
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
  CONSTRAINT "internal_chat_attachments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "internal_chat_threads_agency_id_last_message_at_idx" ON "internal_chat_threads"("agency_id", "last_message_at");

CREATE UNIQUE INDEX "internal_chat_participants_thread_id_user_id_key" ON "internal_chat_participants"("thread_id", "user_id");
CREATE INDEX "internal_chat_participants_user_id_idx" ON "internal_chat_participants"("user_id");

CREATE INDEX "internal_chat_messages_thread_id_occurred_at_idx" ON "internal_chat_messages"("thread_id", "occurred_at");
CREATE INDEX "internal_chat_messages_agency_id_thread_id_client_message_id_idx" ON "internal_chat_messages"("agency_id", "thread_id", "client_message_id");

CREATE INDEX "internal_chat_attachments_message_id_idx" ON "internal_chat_attachments"("message_id");
CREATE INDEX "internal_chat_attachments_agency_id_scan_status_idx" ON "internal_chat_attachments"("agency_id", "scan_status");

ALTER TABLE "internal_chat_threads" ADD CONSTRAINT "internal_chat_threads_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "internal_chat_threads" ADD CONSTRAINT "internal_chat_threads_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "internal_chat_participants" ADD CONSTRAINT "internal_chat_participants_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "internal_chat_participants" ADD CONSTRAINT "internal_chat_participants_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "internal_chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "internal_chat_participants" ADD CONSTRAINT "internal_chat_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "internal_chat_messages" ADD CONSTRAINT "internal_chat_messages_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "internal_chat_messages" ADD CONSTRAINT "internal_chat_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "internal_chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "internal_chat_messages" ADD CONSTRAINT "internal_chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "internal_chat_attachments" ADD CONSTRAINT "internal_chat_attachments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "internal_chat_attachments" ADD CONSTRAINT "internal_chat_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "internal_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "internal_chat_attachments" ADD CONSTRAINT "internal_chat_attachments_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
