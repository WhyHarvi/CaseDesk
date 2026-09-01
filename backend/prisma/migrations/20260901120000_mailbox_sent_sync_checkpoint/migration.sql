ALTER TABLE "agency_microsoft_mailbox_connections"
ADD COLUMN "last_sent_synced_at" TIMESTAMP(3);

ALTER TABLE "user_mailbox_connections"
ADD COLUMN "last_sent_synced_at" TIMESTAMP(3);
