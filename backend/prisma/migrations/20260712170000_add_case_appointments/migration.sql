CREATE TYPE "AppointmentStatus" AS ENUM ('Scheduled', 'Completed', 'Cancelled');

CREATE TABLE "appointments" (
  "id" TEXT NOT NULL,
  "agency_id" TEXT NOT NULL,
  "client_id" TEXT NOT NULL,
  "case_id" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "location" TEXT,
  "calendar" TEXT NOT NULL DEFAULT 'Case Calendar',
  "starts_at" TIMESTAMP(3) NOT NULL,
  "ends_at" TIMESTAMP(3) NOT NULL,
  "description" TEXT,
  "assigned_to_id" TEXT,
  "created_by_id" TEXT NOT NULL,
  "status" "AppointmentStatus" NOT NULL DEFAULT 'Scheduled',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "appointments_agency_id_idx" ON "appointments"("agency_id");
CREATE INDEX "appointments_case_id_starts_at_idx" ON "appointments"("case_id", "starts_at");
CREATE INDEX "appointments_client_id_idx" ON "appointments"("client_id");
CREATE INDEX "appointments_assigned_to_id_idx" ON "appointments"("assigned_to_id");

ALTER TABLE "appointments" ADD CONSTRAINT "appointments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_assigned_to_id_fkey" FOREIGN KEY ("assigned_to_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
