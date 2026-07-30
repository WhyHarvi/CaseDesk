CREATE TABLE "lead_settings" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "welcome_email_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lead_settings_agency_id_key" ON "lead_settings"("agency_id");

ALTER TABLE "lead_settings" ADD CONSTRAINT "lead_settings_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
