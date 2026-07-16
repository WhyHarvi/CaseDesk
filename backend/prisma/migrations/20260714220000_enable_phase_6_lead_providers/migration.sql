ALTER TABLE "lead_source_connections" DROP CONSTRAINT "lead_source_connections_provider_check";
ALTER TABLE "lead_source_connections" ADD CONSTRAINT "lead_source_connections_provider_check"
  CHECK ("provider" IN ('WEBSITE', 'META', 'WHATSAPP', 'GOOGLE_ADS', 'EMAIL', 'OOMA'));

-- Email-originated inquiries may have a valid reply address before a phone number is known.
ALTER TABLE "leads" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "phone_normalized" DROP NOT NULL;
