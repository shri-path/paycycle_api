-- US-009: Subscription & Pricing Management
-- CreateEnum
CREATE TYPE "billing_cycle" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "vendor_subscription_status" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "subscription_event_type" AS ENUM ('CREATED', 'UPGRADED', 'DOWNGRADED', 'RENEWED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "invoice_payment_status" AS ENUM ('PAID', 'PENDING', 'OVERDUE');

-- CreateTable
CREATE TABLE "subscription_plans" (
    "id" BIGSERIAL NOT NULL,
    "plan_name" VARCHAR(50) NOT NULL,
    "plan_code" VARCHAR(20) NOT NULL,
    "price_monthly" DECIMAL(10,2) NOT NULL,
    "price_yearly" DECIMAL(10,2),
    "max_customers" INTEGER NOT NULL DEFAULT 0,
    "max_staff" INTEGER NOT NULL DEFAULT 0,
    "max_supply_lists" INTEGER NOT NULL DEFAULT 0,
    "features" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_subscriptions" (
    "id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "subscription_plan_id" BIGINT NOT NULL,
    "billing_cycle" "billing_cycle" NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "next_billing_date" DATE,
    "status" "vendor_subscription_status" NOT NULL DEFAULT 'ACTIVE',
    "amount_paid" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "auto_renewal" BOOLEAN NOT NULL DEFAULT true,
    "is_trial" BOOLEAN NOT NULL DEFAULT false,
    "trial_ends_at" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_subscription_history" (
    "id" BIGSERIAL NOT NULL,
    "vendor_subscription_id" BIGINT NOT NULL,
    "event_type" "subscription_event_type" NOT NULL,
    "old_plan_id" BIGINT,
    "new_plan_id" BIGINT,
    "reason" TEXT,
    "performed_by_user_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_subscription_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_invoices" (
    "id" BIGSERIAL NOT NULL,
    "vendor_subscription_id" BIGINT NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "invoice_number" VARCHAR(50) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "tax" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(10,2) NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "payment_status" "invoice_payment_status" NOT NULL DEFAULT 'PENDING',
    "payment_date" DATE,
    "payment_method" VARCHAR(50),
    "payment_reference" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_plans_plan_code_key" ON "subscription_plans"("plan_code");

-- CreateIndex
CREATE INDEX "subscription_plans_plan_code_idx" ON "subscription_plans"("plan_code");

-- CreateIndex
CREATE INDEX "subscription_plans_is_active_idx" ON "subscription_plans"("is_active");

-- CreateIndex
CREATE INDEX "vendor_subscriptions_vendor_id_idx" ON "vendor_subscriptions"("vendor_id");

-- CreateIndex
CREATE INDEX "vendor_subscriptions_subscription_plan_id_idx" ON "vendor_subscriptions"("subscription_plan_id");

-- CreateIndex
CREATE INDEX "vendor_subscriptions_status_idx" ON "vendor_subscriptions"("status");

-- CreateIndex
CREATE INDEX "vendor_subscriptions_next_billing_date_idx" ON "vendor_subscriptions"("next_billing_date");

-- CreateIndex
CREATE INDEX "vendor_subscriptions_vendor_id_status_idx" ON "vendor_subscriptions"("vendor_id", "status");

-- CreateIndex
CREATE INDEX "vendor_subscription_history_vendor_subscription_id_idx" ON "vendor_subscription_history"("vendor_subscription_id");

-- CreateIndex
CREATE INDEX "vendor_subscription_history_created_at_idx" ON "vendor_subscription_history"("created_at");

-- CreateIndex
CREATE INDEX "vendor_subscription_history_event_type_idx" ON "vendor_subscription_history"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_invoice_number_key" ON "subscription_invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "subscription_invoices_vendor_subscription_id_idx" ON "subscription_invoices"("vendor_subscription_id");

-- CreateIndex
CREATE INDEX "subscription_invoices_vendor_id_idx" ON "subscription_invoices"("vendor_id");

-- CreateIndex
CREATE INDEX "subscription_invoices_payment_status_idx" ON "subscription_invoices"("payment_status");

-- CreateIndex
CREATE INDEX "subscription_invoices_created_at_idx" ON "subscription_invoices"("created_at");

-- AddForeignKey
ALTER TABLE "vendor_subscriptions" ADD CONSTRAINT "vendor_subscriptions_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_subscriptions" ADD CONSTRAINT "vendor_subscriptions_subscription_plan_id_fkey" FOREIGN KEY ("subscription_plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_subscription_history" ADD CONSTRAINT "vendor_subscription_history_vendor_subscription_id_fkey" FOREIGN KEY ("vendor_subscription_id") REFERENCES "vendor_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_vendor_subscription_id_fkey" FOREIGN KEY ("vendor_subscription_id") REFERENCES "vendor_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index: only one ACTIVE/TRIAL/PAST_DUE subscription per vendor (end_date IS NULL)
-- Prisma cannot express partial unique indexes; added here as a raw SQL constraint.
CREATE UNIQUE INDEX uq_vendor_active_subscription ON vendor_subscriptions(vendor_id) WHERE status IN ('TRIAL','ACTIVE','PAST_DUE') AND end_date IS NULL;
