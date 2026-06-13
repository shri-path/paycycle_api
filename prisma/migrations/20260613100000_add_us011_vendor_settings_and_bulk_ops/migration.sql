-- US-011: Extend vendor_settings + add bulk_operations_log

-- 1. Extend vendor_settings with new columns
ALTER TABLE "vendor_settings"
  ADD COLUMN IF NOT EXISTS "default_credit_limit" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "default_credit_period_days" INTEGER,
  ADD COLUMN IF NOT EXISTS "bulk_operation_concurrency_limit" INTEGER NOT NULL DEFAULT 50;

-- 2. Create enums for bulk operations
DO $$ BEGIN
  CREATE TYPE "bulk_operation_type" AS ENUM ('MARK_LEAVE', 'ADJUST_RATE', 'SEND_REMINDERS');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "bulk_operation_target_type" AS ENUM ('ALL', 'SUBSCRIPTION', 'CUSTOMER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "bulk_operation_status" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- 3. Create bulk_operations_log table
CREATE TABLE IF NOT EXISTS "bulk_operations_log" (
  "id"                    BIGSERIAL PRIMARY KEY,
  "vendor_id"             BIGINT NOT NULL,
  "operation_type"        "bulk_operation_type" NOT NULL,
  "target_type"           "bulk_operation_target_type" NOT NULL,
  "target_id"             BIGINT,
  "affected_count"        INTEGER NOT NULL DEFAULT 0,
  "status"                "bulk_operation_status" NOT NULL DEFAULT 'PENDING',
  "metadata"              JSONB NOT NULL DEFAULT '{}',
  "error_message"         TEXT,
  "performed_by_user_id"  BIGINT NOT NULL,
  "started_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at"          TIMESTAMP(3),
  "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"            TIMESTAMP(3)
);

-- 4. Foreign keys
ALTER TABLE "bulk_operations_log"
  ADD CONSTRAINT "bulk_operations_log_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE RESTRICT,
  ADD CONSTRAINT "bulk_operations_log_performed_by_user_id_fkey"
    FOREIGN KEY ("performed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT;

-- 5. Indexes
CREATE INDEX IF NOT EXISTS "bulk_ops_vendor_id_idx"          ON "bulk_operations_log"("vendor_id");
CREATE INDEX IF NOT EXISTS "bulk_ops_status_idx"             ON "bulk_operations_log"("status");
CREATE INDEX IF NOT EXISTS "bulk_ops_operation_type_idx"     ON "bulk_operations_log"("operation_type");
CREATE INDEX IF NOT EXISTS "bulk_ops_performed_by_idx"       ON "bulk_operations_log"("performed_by_user_id");
CREATE INDEX IF NOT EXISTS "bulk_ops_deleted_at_idx"         ON "bulk_operations_log"("deleted_at");
CREATE INDEX IF NOT EXISTS "bulk_ops_created_at_idx"         ON "bulk_operations_log"("created_at");
CREATE INDEX IF NOT EXISTS "bulk_ops_vendor_status_idx"      ON "bulk_operations_log"("vendor_id", "status");
