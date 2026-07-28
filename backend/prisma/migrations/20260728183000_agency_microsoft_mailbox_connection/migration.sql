CREATE TABLE "agency_microsoft_mailbox_connections" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'Microsoft 365',
    "provider_account_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "email_address" TEXT NOT NULL,
    "display_name" TEXT,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT NOT NULL,
    "access_token_expires_at" TIMESTAMP(3) NOT NULL,
    "granted_scopes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "inbound_enabled" BOOLEAN NOT NULL DEFAULT true,
    "connected_by_id" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_synced_at" TIMESTAMP(3),
    "last_sync_status" TEXT,
    "last_sync_message" TEXT,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "agency_microsoft_mailbox_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agency_microsoft_mailbox_connections_agency_id_key"
ON "agency_microsoft_mailbox_connections"("agency_id");

CREATE UNIQUE INDEX "agency_microsoft_mailbox_connections_email_address_key"
ON "agency_microsoft_mailbox_connections"("email_address");

CREATE INDEX "agency_microsoft_mailbox_connections_status_enabled_idx"
ON "agency_microsoft_mailbox_connections"("status", "enabled");

CREATE INDEX "agency_microsoft_mailbox_connections_inbound_enabled_status_idx"
ON "agency_microsoft_mailbox_connections"("inbound_enabled", "status");

ALTER TABLE "agency_microsoft_mailbox_connections"
ADD CONSTRAINT "agency_microsoft_mailbox_connections_agency_id_fkey"
FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "agency_microsoft_mailbox_connections" ENABLE ROW LEVEL SECURITY;
