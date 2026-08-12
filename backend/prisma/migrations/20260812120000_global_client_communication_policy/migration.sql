CREATE TABLE "agency_client_communication_policies" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "communication_enabled" BOOLEAN NOT NULL DEFAULT true,
    "preferred_channel" "CommunicationChannel",
    "language" TEXT NOT NULL DEFAULT 'English',
    "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "allow_email" BOOLEAN NOT NULL DEFAULT true,
    "allow_sms" BOOLEAN NOT NULL DEFAULT true,
    "allow_chat" BOOLEAN NOT NULL DEFAULT true,
    "allow_calls" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_client_communication_policies_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "agency_client_communication_policies_agency_id_key"
ON "agency_client_communication_policies"("agency_id");

ALTER TABLE "agency_client_communication_policies"
ADD CONSTRAINT "agency_client_communication_policies_agency_id_fkey"
FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
