CREATE TABLE "user_mailbox_connections" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
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
    "sync_enabled" BOOLEAN NOT NULL DEFAULT true,
    "signature_html" TEXT,
    "last_synced_at" TIMESTAMP(3),
    "last_sync_status" TEXT,
    "last_sync_message" TEXT,
    "last_error" TEXT,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "user_mailbox_connections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_mailbox_connections_user_id_key" ON "user_mailbox_connections"("user_id");
CREATE UNIQUE INDEX "user_mailbox_connections_agency_id_email_address_key" ON "user_mailbox_connections"("agency_id", "email_address");
CREATE INDEX "user_mailbox_connections_agency_id_status_idx" ON "user_mailbox_connections"("agency_id", "status");
CREATE INDEX "user_mailbox_connections_sync_enabled_status_idx" ON "user_mailbox_connections"("sync_enabled", "status");

ALTER TABLE "user_mailbox_connections" ADD CONSTRAINT "user_mailbox_connections_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_mailbox_connections" ADD CONSTRAINT "user_mailbox_connections_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- OAuth tokens are server-only secrets. With RLS enabled and no client-facing
-- policies, Supabase browser roles cannot query this table directly.
ALTER TABLE "user_mailbox_connections" ENABLE ROW LEVEL SECURITY;
