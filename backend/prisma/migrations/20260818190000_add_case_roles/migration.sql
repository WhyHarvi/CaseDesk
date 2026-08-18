-- CreateTable
CREATE TABLE "agency_case_roles" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agency_case_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_role_assignments" (
    "id" TEXT NOT NULL,
    "agency_id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "case_role_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "assigned_by" TEXT,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'active',
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "case_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agency_case_roles_agency_id_is_active_sort_order_idx" ON "agency_case_roles"("agency_id", "is_active", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "agency_case_roles_agency_id_code_key" ON "agency_case_roles"("agency_id", "code");

-- CreateIndex
CREATE INDEX "case_role_assignments_agency_id_case_id_status_idx" ON "case_role_assignments"("agency_id", "case_id", "status");

-- CreateIndex
CREATE INDEX "case_role_assignments_agency_id_user_id_status_idx" ON "case_role_assignments"("agency_id", "user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "case_role_assignments_agency_id_case_id_case_role_id_user_i_key" ON "case_role_assignments"("agency_id", "case_id", "case_role_id", "user_id");

-- AddForeignKey
ALTER TABLE "agency_case_roles" ADD CONSTRAINT "agency_case_roles_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_role_assignments" ADD CONSTRAINT "case_role_assignments_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_role_assignments" ADD CONSTRAINT "case_role_assignments_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_role_assignments" ADD CONSTRAINT "case_role_assignments_case_role_id_fkey" FOREIGN KEY ("case_role_id") REFERENCES "agency_case_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_role_assignments" ADD CONSTRAINT "case_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "case_role_assignments" ADD CONSTRAINT "case_role_assignments_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
