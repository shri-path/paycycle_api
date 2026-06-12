-- CreateEnum
CREATE TYPE "customer_status" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "payment_method" AS ENUM ('CASH', 'ONLINE', 'UPI', 'OTHER');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "area" VARCHAR(100),
ADD COLUMN     "created_by_user_id" BIGINT,
ADD COLUMN     "credit_limit" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "customer_since" DATE,
ADD COLUMN     "language_preference" VARCHAR(10) NOT NULL DEFAULT 'en',
ADD COLUMN     "payment_score" DECIMAL(5,2) NOT NULL DEFAULT 100,
ADD COLUMN     "phone_country_code" VARCHAR(5) NOT NULL DEFAULT '+91',
ADD COLUMN     "status" "customer_status" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "payments" (
    "id" BIGSERIAL NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "payment_date" DATE NOT NULL,
    "payment_method" "payment_method" NOT NULL DEFAULT 'CASH',
    "reference_number" VARCHAR(100),
    "recorded_by_user_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_customer_id_idx" ON "payments"("customer_id");

-- CreateIndex
CREATE INDEX "payments_vendor_id_idx" ON "payments"("vendor_id");

-- CreateIndex
CREATE INDEX "payments_payment_date_idx" ON "payments"("payment_date");

-- CreateIndex
CREATE INDEX "payments_customer_id_payment_date_idx" ON "payments"("customer_id", "payment_date");

-- CreateIndex
CREATE INDEX "payments_vendor_id_customer_id_idx" ON "payments"("vendor_id", "customer_id");

-- CreateIndex
CREATE INDEX "customers_status_idx" ON "customers"("status");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
