CREATE TABLE "agency_fee_categories" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'Other',
    "qbo_item_id" TEXT,
    "qbo_item_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_fee_categories_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "booking_payment_holds"
    ADD COLUMN "qb_payment_id" TEXT,
    ADD COLUMN "payment_method" TEXT,
    ADD COLUMN "manual_payment_note" TEXT;

CREATE UNIQUE INDEX "agency_fee_categories_agency_id_code_key"
    ON "agency_fee_categories"("agency_id", "code");
CREATE INDEX "agency_fee_categories_agency_id_is_active_sort_order_idx"
    ON "agency_fee_categories"("agency_id", "is_active", "sort_order");
CREATE UNIQUE INDEX "booking_payment_holds_agency_id_qb_payment_id_key"
    ON "booking_payment_holds"("agency_id", "qb_payment_id");

ALTER TABLE "agency_fee_categories"
    ADD CONSTRAINT "agency_fee_categories_agency_id_fkey"
    FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "agency_fee_categories"
    ("id", "agency_id", "code", "name", "description", "kind", "qbo_item_id", "qbo_item_name", "is_active", "is_system", "sort_order", "created_at", "updated_at")
SELECT
    gen_random_uuid()::text,
    a."id",
    defaults."code",
    defaults."name",
    defaults."description",
    defaults."kind",
    CASE defaults."code"
        WHEN 'fees' THEN q."fee_item_id"
        WHEN 'disbursement' THEN q."disbursement_item_id"
        WHEN 'consultation' THEN q."consult_fee_item_id"
        ELSE NULL
    END,
    CASE defaults."code"
        WHEN 'fees' THEN q."fee_item_name"
        WHEN 'disbursement' THEN q."disbursement_item_name"
        WHEN 'consultation' THEN q."consult_fee_item_name"
        ELSE NULL
    END,
    true,
    true,
    defaults."sort_order",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "agencies" a
LEFT JOIN "agency_quickbooks_settings" q ON q."agency_id" = a."id"
CROSS JOIN (VALUES
    ('fees', 'Professional fees', 'Legal and immigration professional services.', 'Professional', 10),
    ('disbursement', 'Government fee disbursements', 'Government, IRCC and third-party disbursements.', 'Government', 20),
    ('consultation', 'Consultation fees', 'Initial and follow-up consultation charges.', 'Consultation', 30),
    ('other', 'Other fees', 'Other client charges configured by the agency.', 'Other', 40)
) AS defaults("code", "name", "description", "kind", "sort_order")
ON CONFLICT ("agency_id", "code") DO NOTHING;
