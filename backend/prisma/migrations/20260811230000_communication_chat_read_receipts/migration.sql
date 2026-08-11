-- Records when the client last had a chat thread open/focused, so staff
-- can see a "read" receipt on their sent messages. Distinct from
-- CommunicationMessage.isRead (already means "not from the client", set
-- immediately for every outbound message) and unreadCount (staff-side
-- badge count) — neither existing field can answer "did the client
-- actually see this." Nullable, no backfill: existing conversations simply
-- start with no known read state.
ALTER TABLE "communication_conversations"
  ADD COLUMN "client_last_read_at" TIMESTAMP(3);
