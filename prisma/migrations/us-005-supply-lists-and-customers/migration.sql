-- US-005: Supply Lists & Customer Subscriptions — schema deltas
-- Adds: customers, vendor_customers (+ enums), supply_lists (+ supply_frequency enum),
--       supply_list_staff, supply_list_schedule, supply_list_customers.
-- Mirrors db-design modules 03/04/05/06 exactly (OQ-1: minimal customer slice).
-- Authored manually because the project tracks schema via `prisma db push`
-- (no _prisma_migrations history). Apply with `prisma db push` or run this SQL.
-- Table order: customers -> vendor_customers -> supply_lists -> staff/schedule -> supply_list_customers.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE "vendor_customer_status" AS ENUM ('ACTIVE', 'PAUSED', 'BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "acquisition_source" AS ENUM ('DIRECT', 'CUSTOMER_REFERRAL', 'INVITE_LINK', 'MANUAL_ADD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    CREATE TYPE "supply_frequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Table: customers (module 03 — minimal US-005 slice)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "customers" (
    "id"                BIGSERIAL    NOT NULL,
    "user_id"           BIGINT       NULL,
    "name"              VARCHAR(100) NULL,
    "phone"             VARCHAR(15)  NOT NULL,
    "email"             VARCHAR(100) NULL,
    "address"          TEXT         NULL,
    "locality"          VARCHAR(100) NULL,
    "auto_mark_enabled" BOOLEAN      NOT NULL DEFAULT TRUE,
    "last_login_at"     TIMESTAMP(3) NULL,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL,
    "deleted_at"        TIMESTAMP(3) NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customers_phone_key" ON "customers" ("phone");
CREATE INDEX IF NOT EXISTS "customers_user_id_idx"    ON "customers" ("user_id");
CREATE INDEX IF NOT EXISTS "customers_phone_idx"      ON "customers" ("phone");
CREATE INDEX IF NOT EXISTS "customers_email_idx"      ON "customers" ("email");
CREATE INDEX IF NOT EXISTS "customers_locality_idx"   ON "customers" ("locality");
CREATE INDEX IF NOT EXISTS "customers_deleted_at_idx" ON "customers" ("deleted_at");

ALTER TABLE "customers"
    ADD CONSTRAINT "customers_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Table: vendor_customers (module 04 — minimal US-005 slice)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "vendor_customers" (
    "id"                      BIGSERIAL                NOT NULL,
    "vendor_id"               BIGINT                   NOT NULL,
    "customer_id"             BIGINT                   NOT NULL,
    "status"                  "vendor_customer_status" NOT NULL DEFAULT 'ACTIVE',
    "referred_by_customer_id" BIGINT                   NULL,
    "acquisition_source"      "acquisition_source"     NULL,
    "created_at"              TIMESTAMP(3)             NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"              TIMESTAMP(3)             NOT NULL,
    "deleted_at"              TIMESTAMP(3)             NULL,

    CONSTRAINT "vendor_customers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vendor_customers_vendor_id_customer_id_key"
    ON "vendor_customers" ("vendor_id", "customer_id");
CREATE INDEX IF NOT EXISTS "vendor_customers_vendor_id_idx"               ON "vendor_customers" ("vendor_id");
CREATE INDEX IF NOT EXISTS "vendor_customers_customer_id_idx"             ON "vendor_customers" ("customer_id");
CREATE INDEX IF NOT EXISTS "vendor_customers_status_idx"                  ON "vendor_customers" ("status");
CREATE INDEX IF NOT EXISTS "vendor_customers_referred_by_customer_id_idx" ON "vendor_customers" ("referred_by_customer_id");
CREATE INDEX IF NOT EXISTS "vendor_customers_deleted_at_idx"              ON "vendor_customers" ("deleted_at");

ALTER TABLE "vendor_customers"
    ADD CONSTRAINT "vendor_customers_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_customers"
    ADD CONSTRAINT "vendor_customers_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "vendor_customers"
    ADD CONSTRAINT "vendor_customers_referred_by_customer_id_fkey"
    FOREIGN KEY ("referred_by_customer_id") REFERENCES "customers" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Table: supply_lists (module 05)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "supply_lists" (
    "id"               BIGSERIAL          NOT NULL,
    "vendor_id"        BIGINT             NOT NULL,
    "name"             VARCHAR(100)       NOT NULL,
    "supply_type"      VARCHAR(50)        NULL,
    "unit"             VARCHAR(20)        NOT NULL,
    "default_quantity" DECIMAL(10,3)      NULL,
    "rate_per_unit"    DECIMAL(10,2)      NULL,
    "start_time"       VARCHAR(5)         NULL,
    "frequency"        "supply_frequency" NOT NULL DEFAULT 'DAILY',
    "is_active"        BOOLEAN            NOT NULL DEFAULT TRUE,
    "created_at"       TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3)       NOT NULL,
    "deleted_at"       TIMESTAMP(3)       NULL,

    CONSTRAINT "supply_lists_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_supply_lists_default_quantity" CHECK ("default_quantity" IS NULL OR "default_quantity" >= 0),
    CONSTRAINT "chk_supply_lists_rate_per_unit"    CHECK ("rate_per_unit"    IS NULL OR "rate_per_unit"    >= 0)
);

CREATE INDEX IF NOT EXISTS "supply_lists_vendor_id_idx"            ON "supply_lists" ("vendor_id");
CREATE INDEX IF NOT EXISTS "supply_lists_is_active_idx"            ON "supply_lists" ("is_active");
CREATE INDEX IF NOT EXISTS "supply_lists_frequency_idx"            ON "supply_lists" ("frequency");
CREATE INDEX IF NOT EXISTS "supply_lists_deleted_at_idx"           ON "supply_lists" ("deleted_at");
CREATE INDEX IF NOT EXISTS "supply_lists_vendor_id_is_active_idx"  ON "supply_lists" ("vendor_id", "is_active");

ALTER TABLE "supply_lists"
    ADD CONSTRAINT "supply_lists_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Table: supply_list_staff (module 05 + FK to vendor_users from module 12)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "supply_list_staff" (
    "id"                  BIGSERIAL    NOT NULL,
    "supply_list_id"      BIGINT       NOT NULL,
    "vendor_user_id"      BIGINT       NOT NULL,
    "is_primary"          BOOLEAN      NOT NULL DEFAULT FALSE,
    "assigned_by_user_id" BIGINT       NULL,
    "assigned_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_list_staff_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "supply_list_staff_supply_list_id_vendor_user_id_key"
    ON "supply_list_staff" ("supply_list_id", "vendor_user_id");
CREATE INDEX IF NOT EXISTS "supply_list_staff_supply_list_id_idx" ON "supply_list_staff" ("supply_list_id");
CREATE INDEX IF NOT EXISTS "supply_list_staff_vendor_user_id_idx" ON "supply_list_staff" ("vendor_user_id");
CREATE INDEX IF NOT EXISTS "supply_list_staff_is_primary_idx"     ON "supply_list_staff" ("is_primary");

ALTER TABLE "supply_list_staff"
    ADD CONSTRAINT "supply_list_staff_supply_list_id_fkey"
    FOREIGN KEY ("supply_list_id") REFERENCES "supply_lists" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supply_list_staff"
    ADD CONSTRAINT "supply_list_staff_vendor_user_id_fkey"
    FOREIGN KEY ("vendor_user_id") REFERENCES "vendor_users" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supply_list_staff"
    ADD CONSTRAINT "supply_list_staff_assigned_by_user_id_fkey"
    FOREIGN KEY ("assigned_by_user_id") REFERENCES "users" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Table: supply_list_schedule (module 05)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "supply_list_schedule" (
    "id"             BIGSERIAL    NOT NULL,
    "supply_list_id" BIGINT       NOT NULL,
    "day_of_week"    SMALLINT     NULL,
    "day_of_month"   SMALLINT     NULL,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supply_list_schedule_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_supply_list_schedule_dow" CHECK ("day_of_week"  IS NULL OR ("day_of_week"  >= 1 AND "day_of_week"  <= 7)),
    CONSTRAINT "chk_supply_list_schedule_dom" CHECK ("day_of_month" IS NULL OR ("day_of_month" >= 1 AND "day_of_month" <= 31))
);

CREATE INDEX IF NOT EXISTS "supply_list_schedule_supply_list_id_idx" ON "supply_list_schedule" ("supply_list_id");

ALTER TABLE "supply_list_schedule"
    ADD CONSTRAINT "supply_list_schedule_supply_list_id_fkey"
    FOREIGN KEY ("supply_list_id") REFERENCES "supply_lists" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Table: supply_list_customers (module 06 — subscriptions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "supply_list_customers" (
    "id"                   BIGSERIAL     NOT NULL,
    "vendor_id"            BIGINT        NOT NULL,
    "supply_list_id"       BIGINT        NOT NULL,
    "customer_id"          BIGINT        NOT NULL,
    "custom_quantity"      DECIMAL(10,3) NULL,
    "custom_rate_per_unit" DECIMAL(10,2) NULL,
    "start_date"           DATE          NULL,
    "end_date"             DATE          NULL,
    "is_active"            BOOLEAN       NOT NULL DEFAULT TRUE,
    "created_at"           TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3)  NOT NULL,
    "deleted_at"           TIMESTAMP(3)  NULL,

    CONSTRAINT "supply_list_customers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_slc_custom_qty"  CHECK ("custom_quantity"      IS NULL OR "custom_quantity"      >= 0),
    CONSTRAINT "chk_slc_custom_rate" CHECK ("custom_rate_per_unit" IS NULL OR "custom_rate_per_unit" >= 0)
);

-- BUG-2: the full (supply_list_id, customer_id) unique index permanently blocked
-- re-subscribing a customer whose prior subscription had ended. Replace it with a
-- PARTIAL unique index that only constrains NON-ended rows (end_date IS NULL), so
-- ENDED history rows are retained and a customer can be re-added after ending.
-- Drop the old full unique index/constraint idempotently (it may exist as either).
DROP INDEX IF EXISTS "supply_list_customers_supply_list_id_customer_id_key";
ALTER TABLE "supply_list_customers"
    DROP CONSTRAINT IF EXISTS "supply_list_customers_supply_list_id_customer_id_key";
-- Partial unique index: at most one active (non-ended) subscription per (list, customer).
CREATE UNIQUE INDEX IF NOT EXISTS "supply_list_customers_active_uq"
    ON "supply_list_customers" ("supply_list_id", "customer_id")
    WHERE "end_date" IS NULL;
-- Non-unique composite index to keep (list, customer) lookups fast for all rows.
CREATE INDEX IF NOT EXISTS "supply_list_customers_supply_list_id_customer_id_idx"
    ON "supply_list_customers" ("supply_list_id", "customer_id");
CREATE INDEX IF NOT EXISTS "supply_list_customers_vendor_id_idx"               ON "supply_list_customers" ("vendor_id");
CREATE INDEX IF NOT EXISTS "supply_list_customers_supply_list_id_idx"          ON "supply_list_customers" ("supply_list_id");
CREATE INDEX IF NOT EXISTS "supply_list_customers_customer_id_idx"             ON "supply_list_customers" ("customer_id");
CREATE INDEX IF NOT EXISTS "supply_list_customers_is_active_idx"               ON "supply_list_customers" ("is_active");
CREATE INDEX IF NOT EXISTS "supply_list_customers_start_date_idx"              ON "supply_list_customers" ("start_date");
CREATE INDEX IF NOT EXISTS "supply_list_customers_end_date_idx"                ON "supply_list_customers" ("end_date");
CREATE INDEX IF NOT EXISTS "supply_list_customers_deleted_at_idx"              ON "supply_list_customers" ("deleted_at");
CREATE INDEX IF NOT EXISTS "supply_list_customers_supply_list_id_is_active_idx" ON "supply_list_customers" ("supply_list_id", "is_active");

ALTER TABLE "supply_list_customers"
    ADD CONSTRAINT "supply_list_customers_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supply_list_customers"
    ADD CONSTRAINT "supply_list_customers_supply_list_id_fkey"
    FOREIGN KEY ("supply_list_id") REFERENCES "supply_lists" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supply_list_customers"
    ADD CONSTRAINT "supply_list_customers_customer_id_fkey"
    FOREIGN KEY ("customer_id") REFERENCES "customers" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
