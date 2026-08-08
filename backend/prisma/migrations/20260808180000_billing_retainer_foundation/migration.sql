-- AlterTable
ALTER TABLE "payment_schedule_templates" ADD COLUMN "case_tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "payment_schedule_templates" ADD COLUMN "is_system_default" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "agency_billing_settings" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "tax_rate_percent" DECIMAL(5,2) NOT NULL DEFAULT 13.0,
    "tax_registered_name" TEXT,
    "tax_number" TEXT,
    "retainer_signature_image" TEXT,
    "retainer_signature_updated_at" TIMESTAMP(3),
    "retainer_signature_updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_billing_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agency_billing_settings_agency_id_key" ON "agency_billing_settings"("agency_id");

-- AddForeignKey
ALTER TABLE "agency_billing_settings" ADD CONSTRAINT "agency_billing_settings_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agency_billing_settings" ADD CONSTRAINT "agency_billing_settings_retainer_signature_updated_by_id_fkey" FOREIGN KEY ("retainer_signature_updated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
