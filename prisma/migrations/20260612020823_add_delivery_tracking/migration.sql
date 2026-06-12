-- CreateEnum
CREATE TYPE "daily_supply_status" AS ENUM ('PENDING', 'DELIVERED', 'LEAVE', 'AUTO_MARKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "actor_role" AS ENUM ('CUSTOMER', 'VENDOR_OWNER', 'VENDOR_STAFF', 'SYSTEM');

-- CreateEnum
CREATE TYPE "leave_type" AS ENUM ('CUSTOMER_REQUESTED', 'VENDOR_MARKED', 'SYSTEM');

-- CreateTable
CREATE TABLE "daily_supplies" (
    "id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "supply_list_customer_id" BIGINT NOT NULL,
    "supply_list_id" BIGINT NOT NULL,
    "service_date" DATE NOT NULL,
    "status" "daily_supply_status" NOT NULL DEFAULT 'PENDING',
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit" VARCHAR(20) NOT NULL,
    "rate_per_unit" DECIMAL(10,2) NOT NULL,
    "base_amount" DECIMAL(10,2) NOT NULL,
    "final_amount" DECIMAL(10,2) NOT NULL,
    "is_auto_marked" BOOLEAN NOT NULL DEFAULT false,
    "marked_by_user_id" BIGINT,
    "marked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_supplies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_overrides" (
    "id" BIGSERIAL NOT NULL,
    "daily_supply_id" BIGINT NOT NULL,
    "changed_by_user_id" BIGINT,
    "actor_role" "actor_role",
    "previous_status" VARCHAR(20),
    "new_status" VARCHAR(20),
    "previous_quantity" DECIMAL(10,3),
    "new_quantity" DECIMAL(10,3),
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supply_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_extra_charges" (
    "id" BIGSERIAL NOT NULL,
    "daily_supply_id" BIGINT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "comment" TEXT NOT NULL,
    "added_by_user_id" BIGINT,
    "added_by_role" "actor_role",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_extra_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leaves" (
    "id" BIGSERIAL NOT NULL,
    "supply_list_customer_id" BIGINT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "leave_type" "leave_type" NOT NULL DEFAULT 'CUSTOMER_REQUESTED',
    "reason" TEXT,
    "created_by_user_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leaves_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_supplies_vendor_id_idx" ON "daily_supplies"("vendor_id");

-- CreateIndex
CREATE INDEX "daily_supplies_supply_list_customer_id_idx" ON "daily_supplies"("supply_list_customer_id");

-- CreateIndex
CREATE INDEX "daily_supplies_supply_list_id_idx" ON "daily_supplies"("supply_list_id");

-- CreateIndex
CREATE INDEX "daily_supplies_service_date_idx" ON "daily_supplies"("service_date");

-- CreateIndex
CREATE INDEX "daily_supplies_status_idx" ON "daily_supplies"("status");

-- CreateIndex
CREATE INDEX "daily_supplies_marked_by_user_id_idx" ON "daily_supplies"("marked_by_user_id");

-- CreateIndex
CREATE INDEX "daily_supplies_vendor_id_service_date_idx" ON "daily_supplies"("vendor_id", "service_date");

-- CreateIndex
CREATE INDEX "daily_supplies_service_date_status_idx" ON "daily_supplies"("service_date", "status");

-- CreateIndex
CREATE INDEX "daily_supplies_supply_list_id_service_date_status_idx" ON "daily_supplies"("supply_list_id", "service_date", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_daily_supplies_list_customer_date" ON "daily_supplies"("supply_list_customer_id", "service_date");

-- CreateIndex
CREATE INDEX "supply_overrides_daily_supply_id_idx" ON "supply_overrides"("daily_supply_id");

-- CreateIndex
CREATE INDEX "supply_overrides_changed_by_user_id_idx" ON "supply_overrides"("changed_by_user_id");

-- CreateIndex
CREATE INDEX "supply_overrides_created_at_idx" ON "supply_overrides"("created_at");

-- CreateIndex
CREATE INDEX "supply_extra_charges_daily_supply_id_idx" ON "supply_extra_charges"("daily_supply_id");

-- CreateIndex
CREATE INDEX "supply_extra_charges_added_by_user_id_idx" ON "supply_extra_charges"("added_by_user_id");

-- CreateIndex
CREATE INDEX "supply_extra_charges_created_at_idx" ON "supply_extra_charges"("created_at");

-- CreateIndex
CREATE INDEX "leaves_supply_list_customer_id_idx" ON "leaves"("supply_list_customer_id");

-- CreateIndex
CREATE INDEX "leaves_start_date_idx" ON "leaves"("start_date");

-- CreateIndex
CREATE INDEX "leaves_end_date_idx" ON "leaves"("end_date");

-- CreateIndex
CREATE INDEX "leaves_created_by_user_id_idx" ON "leaves"("created_by_user_id");

-- CreateIndex
CREATE INDEX "leaves_start_date_end_date_idx" ON "leaves"("start_date", "end_date");

-- AddForeignKey
ALTER TABLE "daily_supplies" ADD CONSTRAINT "daily_supplies_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_supplies" ADD CONSTRAINT "daily_supplies_supply_list_customer_id_fkey" FOREIGN KEY ("supply_list_customer_id") REFERENCES "supply_list_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_supplies" ADD CONSTRAINT "daily_supplies_supply_list_id_fkey" FOREIGN KEY ("supply_list_id") REFERENCES "supply_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_supplies" ADD CONSTRAINT "daily_supplies_marked_by_user_id_fkey" FOREIGN KEY ("marked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_overrides" ADD CONSTRAINT "supply_overrides_daily_supply_id_fkey" FOREIGN KEY ("daily_supply_id") REFERENCES "daily_supplies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_overrides" ADD CONSTRAINT "supply_overrides_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_extra_charges" ADD CONSTRAINT "supply_extra_charges_daily_supply_id_fkey" FOREIGN KEY ("daily_supply_id") REFERENCES "daily_supplies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_extra_charges" ADD CONSTRAINT "supply_extra_charges_added_by_user_id_fkey" FOREIGN KEY ("added_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_supply_list_customer_id_fkey" FOREIGN KEY ("supply_list_customer_id") REFERENCES "supply_list_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaves" ADD CONSTRAINT "leaves_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
