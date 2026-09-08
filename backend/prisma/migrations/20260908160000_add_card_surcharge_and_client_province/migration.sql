-- Card/bank-transfer surcharge rates and item mappings, mirroring the
-- existing refund_fee_rate_percent + fee/disbursement/consult item
-- mapping columns on agency_quickbooks_settings.
ALTER TABLE "agency_quickbooks_settings"
  ADD COLUMN IF NOT EXISTS "card_surcharge_rate_percent" DECIMAL(5,3) NOT NULL DEFAULT 2.4,
  ADD COLUMN IF NOT EXISTS "bank_transfer_fee_rate_percent" DECIMAL(5,3) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS "card_surcharge_item_id" TEXT,
  ADD COLUMN IF NOT EXISTS "card_surcharge_item_name" TEXT,
  ADD COLUMN IF NOT EXISTS "bank_transfer_fee_item_id" TEXT,
  ADD COLUMN IF NOT EXISTS "bank_transfer_fee_item_name" TEXT;

-- Structured province, separate from the free-text address column, so the
-- Quebec credit-card-surcharge exclusion (Quebec's Consumer Protection Act
-- bans surcharging outright) can be enforced reliably.
ALTER TABLE "clients"
  ADD COLUMN IF NOT EXISTS "province" TEXT;
