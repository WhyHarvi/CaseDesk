-- Reply, react, and edit (internal chat only) support for both chat
-- systems. CommunicationMessage already has parentMessageId/parentMessage
-- (built for email reply-chains) — reused as-is for client-chat reply-to,
-- no column needed there. Client chat intentionally gets no edited_at:
-- those messages are part of the case record and must never be silently
-- rewritten (delete already exists, admin-gated and audit-logged).

ALTER TABLE "internal_chat_messages" ADD COLUMN "reply_to_id" TEXT;
ALTER TABLE "internal_chat_messages" ADD COLUMN "edited_at" TIMESTAMP(3);

ALTER TABLE "internal_chat_messages" ADD CONSTRAINT "internal_chat_messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "internal_chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "internal_chat_message_reactions" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "internal_chat_message_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "internal_chat_message_reactions_message_id_user_id_emoji_key" ON "internal_chat_message_reactions"("message_id", "user_id", "emoji");
CREATE INDEX "internal_chat_message_reactions_message_id_idx" ON "internal_chat_message_reactions"("message_id");

ALTER TABLE "internal_chat_message_reactions" ADD CONSTRAINT "internal_chat_message_reactions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "internal_chat_message_reactions" ADD CONSTRAINT "internal_chat_message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "internal_chat_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "internal_chat_message_reactions" ADD CONSTRAINT "internal_chat_message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "communication_message_reactions" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "emoji" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "communication_message_reactions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "communication_message_reactions_message_id_user_id_emoji_key" ON "communication_message_reactions"("message_id", "user_id", "emoji");
CREATE INDEX "communication_message_reactions_message_id_idx" ON "communication_message_reactions"("message_id");

ALTER TABLE "communication_message_reactions" ADD CONSTRAINT "communication_message_reactions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_message_reactions" ADD CONSTRAINT "communication_message_reactions_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "communication_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "communication_message_reactions" ADD CONSTRAINT "communication_message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
