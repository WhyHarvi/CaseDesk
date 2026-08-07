-- AlterTable: give a lead a place to hold a retainer agreement before it's
-- really converted. Set the moment the lead's first consultation is
-- confirmed (see confirmManagedBooking in publicBookingController.js).
-- Deliberately separate from converted_client_id/converted_case_id, which
-- mean "this lead IS this client now" and are checked throughout the app —
-- these mean "a client/case exists to hold this lead's retainer" while the
-- lead keeps working its own pipeline.
ALTER TABLE "leads" ADD COLUMN "early_client_id" TEXT UNIQUE REFERENCES "clients"("id") ON DELETE SET NULL;
ALTER TABLE "leads" ADD COLUMN "early_case_id" TEXT UNIQUE REFERENCES "cases"("id") ON DELETE SET NULL;
