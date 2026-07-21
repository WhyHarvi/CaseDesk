BEGIN;

ALTER TABLE "agency_ooma_settings"
  ALTER COLUMN "api_base_url" DROP NOT NULL,
  ALTER COLUMN "api_key_encrypted" DROP NOT NULL,
  ALTER COLUMN "from_number" DROP NOT NULL;

COMMIT;
