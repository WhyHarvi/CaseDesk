ALTER TABLE "agencies"
  ADD COLUMN "legal_name" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "logo_url" TEXT,
  ADD COLUMN "business_number" TEXT,
  ADD COLUMN "tax_number" TEXT,
  ADD COLUMN "default_currency" TEXT NOT NULL DEFAULT 'CAD',
  ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en-CA',
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Toronto',
  ADD COLUMN "payment_instructions" TEXT;

ALTER TABLE "payments"
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'CAD';

CREATE TABLE "account_statement_generations" (
  "id" TEXT NOT NULL,
  "sequence" SERIAL NOT NULL,
  "statement_number" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "case_id" TEXT,
  "generated_by_id" TEXT NOT NULL,
  "date_from" TIMESTAMP(3),
  "date_to" TIMESTAMP(3),
  "currency" TEXT NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_statement_generations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "account_statement_generations_sequence_key" ON "account_statement_generations"("sequence");
CREATE UNIQUE INDEX "account_statement_generations_statement_number_key" ON "account_statement_generations"("statement_number");
CREATE INDEX "account_statement_generations_agency_id_client_id_generated_at_idx" ON "account_statement_generations"("agency_id", "client_id", "generated_at");
CREATE INDEX "account_statement_generations_case_id_idx" ON "account_statement_generations"("case_id");

ALTER TABLE "account_statement_generations" ADD CONSTRAINT "account_statement_generations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_statement_generations" ADD CONSTRAINT "account_statement_generations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "account_statement_generations" ADD CONSTRAINT "account_statement_generations_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "account_statement_generations" ADD CONSTRAINT "account_statement_generations_generated_by_id_fkey" FOREIGN KEY ("generated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
