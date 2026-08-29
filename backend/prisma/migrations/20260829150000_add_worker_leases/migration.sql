CREATE TABLE "worker_leases" (
    "lease_key" TEXT NOT NULL,
    "owner_id" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_leases_pkey" PRIMARY KEY ("lease_key")
);

CREATE INDEX "worker_leases_expires_at_idx" ON "worker_leases"("expires_at");
