-- CreateEnum
CREATE TYPE "credit_type" AS ENUM ('NORMAL', 'PREPAID', 'UNLIMITED');

-- CreateEnum
CREATE TYPE "credit_breach_action" AS ENUM ('WARN', 'PAUSE', 'BLOCK');

-- CreateEnum
CREATE TYPE "reminder_channel" AS ENUM ('WHATSAPP', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "reminder_status" AS ENUM ('SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "reminder_response_type" AS ENUM ('NONE', 'FULL_PAYMENT', 'PARTIAL_PAYMENT');

-- DropForeignKey
ALTER TABLE "bulk_operations_log" DROP CONSTRAINT "bulk_operations_log_performed_by_user_id_fkey";

-- DropForeignKey
ALTER TABLE "bulk_operations_log" DROP CONSTRAINT "bulk_operations_log_vendor_id_fkey";

-- AlterTable
ALTER TABLE "bulk_operations_log" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "vendor_settings" ALTER COLUMN "updated_at" DROP DEFAULT;

-- CreateTable
CREATE TABLE "customer_credit_settings" (
    "id" BIGSERIAL NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "credit_type" "credit_type" NOT NULL DEFAULT 'NORMAL',
    "warning_threshold_percent" INTEGER NOT NULL DEFAULT 90,
    "action_on_breach" "credit_breach_action" NOT NULL DEFAULT 'WARN',
    "minimum_balance_warning" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_credit_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_config" (
    "id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "auto_reminders_enabled" BOOLEAN NOT NULL DEFAULT false,
    "schedule_3_days" BOOLEAN NOT NULL DEFAULT true,
    "schedule_15_days" BOOLEAN NOT NULL DEFAULT true,
    "schedule_30_days" BOOLEAN NOT NULL DEFAULT true,
    "reminder_template" TEXT,
    "excluded_customer_ids" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reminders" (
    "id" BIGSERIAL NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "amount_due" DECIMAL(10,2) NOT NULL,
    "reminder_date" DATE NOT NULL,
    "sent_via" "reminder_channel" NOT NULL,
    "status" "reminder_status" NOT NULL DEFAULT 'SENT',
    "response_type" "reminder_response_type",
    "response_amount" DECIMAL(10,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_settings_customer_id_key" ON "customer_credit_settings"("customer_id");

-- CreateIndex
CREATE INDEX "customer_credit_settings_customer_id_idx" ON "customer_credit_settings"("customer_id");

-- CreateIndex
CREATE INDEX "customer_credit_settings_credit_type_idx" ON "customer_credit_settings"("credit_type");

-- CreateIndex
CREATE INDEX "customer_credit_settings_created_at_idx" ON "customer_credit_settings"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_config_vendor_id_key" ON "reminder_config"("vendor_id");

-- CreateIndex
CREATE INDEX "reminder_config_vendor_id_idx" ON "reminder_config"("vendor_id");

-- CreateIndex
CREATE INDEX "reminder_config_auto_reminders_enabled_idx" ON "reminder_config"("auto_reminders_enabled");

-- CreateIndex
CREATE INDEX "reminder_config_created_at_idx" ON "reminder_config"("created_at");

-- CreateIndex
CREATE INDEX "payment_reminders_customer_id_idx" ON "payment_reminders"("customer_id");

-- CreateIndex
CREATE INDEX "payment_reminders_vendor_id_idx" ON "payment_reminders"("vendor_id");

-- CreateIndex
CREATE INDEX "payment_reminders_reminder_date_idx" ON "payment_reminders"("reminder_date");

-- CreateIndex
CREATE INDEX "payment_reminders_customer_id_reminder_date_idx" ON "payment_reminders"("customer_id", "reminder_date");

-- CreateIndex
CREATE INDEX "payment_reminders_vendor_id_reminder_date_idx" ON "payment_reminders"("vendor_id", "reminder_date");

-- CreateIndex
CREATE INDEX "payment_reminders_status_idx" ON "payment_reminders"("status");

-- AddForeignKey
ALTER TABLE "bulk_operations_log" ADD CONSTRAINT "bulk_operations_log_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bulk_operations_log" ADD CONSTRAINT "bulk_operations_log_performed_by_user_id_fkey" FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_settings" ADD CONSTRAINT "customer_credit_settings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_config" ADD CONSTRAINT "reminder_config_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique index: at most one reminder per (customer, day).
-- Prisma cannot express partial unique constraints, so it's added here.
CREATE UNIQUE INDEX "payment_reminders_customer_date_uq"
  ON "payment_reminders" ("customer_id", "reminder_date");

-- RenameIndex
ALTER INDEX "bulk_ops_created_at_idx" RENAME TO "bulk_operations_log_created_at_idx";

-- RenameIndex
ALTER INDEX "bulk_ops_deleted_at_idx" RENAME TO "bulk_operations_log_deleted_at_idx";

-- RenameIndex
ALTER INDEX "bulk_ops_operation_type_idx" RENAME TO "bulk_operations_log_operation_type_idx";

-- RenameIndex
ALTER INDEX "bulk_ops_performed_by_idx" RENAME TO "bulk_operations_log_performed_by_user_id_idx";

-- RenameIndex
ALTER INDEX "bulk_ops_status_idx" RENAME TO "bulk_operations_log_status_idx";

-- RenameIndex
ALTER INDEX "bulk_ops_vendor_id_idx" RENAME TO "bulk_operations_log_vendor_id_idx";

-- RenameIndex
ALTER INDEX "bulk_ops_vendor_status_idx" RENAME TO "bulk_operations_log_vendor_id_status_idx";
