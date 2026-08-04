CREATE UNIQUE INDEX "booking_payment_holds_agency_id_manual_payment_reference_key"
    ON "booking_payment_holds"("agency_id", "manual_payment_reference");
