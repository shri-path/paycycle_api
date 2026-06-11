-- Initial baseline migration — captures the schema that was bootstrapped via
-- `prisma db push` before the project adopted named migration files.
-- Covers all tables that existed BEFORE us-002-roles-access was applied.
-- Must be marked as already applied on existing DBs:
--   npx prisma migrate resolve --applied "00-init"

-- ---------------------------------------------------------------------------
-- Enum: vendor_user_status
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE "vendor_user_status" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED', 'REMOVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Table: users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "users" (
    "id"                 BIGSERIAL    NOT NULL,
    "phone"              VARCHAR(15)  NOT NULL,
    "password_hash"      VARCHAR(255) NOT NULL,
    "name"               VARCHAR(100),
    "email"              VARCHAR(100),
    "profile_photo_url"  VARCHAR(500),
    "preferred_language" VARCHAR(10)  NOT NULL DEFAULT 'en',
    "last_login_at"      TIMESTAMP(3),
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL,
    "deleted_at"         TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_phone_key"  ON "users" ("phone");
CREATE INDEX        IF NOT EXISTS "users_phone_idx"  ON "users" ("phone");
CREATE INDEX        IF NOT EXISTS "users_email_idx"  ON "users" ("email");
CREATE INDEX        IF NOT EXISTS "users_created_at_idx" ON "users" ("created_at");
CREATE INDEX        IF NOT EXISTS "users_deleted_at_idx" ON "users" ("deleted_at");

-- ---------------------------------------------------------------------------
-- Table: user_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "user_sessions" (
    "id"               BIGSERIAL    NOT NULL,
    "user_id"          BIGINT       NOT NULL,
    "access_token"     VARCHAR(500),
    "refresh_token"    VARCHAR(500),
    "device_id"        VARCHAR(100),
    "device_name"      VARCHAR(200),
    "ip_address"       VARCHAR(45),
    "user_agent"       TEXT,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at"       TIMESTAMP(3) NOT NULL,
    "revoked_at"       TIMESTAMP(3),
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_sessions_user_id_idx"       ON "user_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "user_sessions_refresh_token_idx" ON "user_sessions" ("refresh_token");
CREATE INDEX IF NOT EXISTS "user_sessions_expires_at_idx"    ON "user_sessions" ("expires_at");
CREATE INDEX IF NOT EXISTS "user_sessions_last_activity_at_idx" ON "user_sessions" ("last_activity_at");

ALTER TABLE "user_sessions"
    ADD CONSTRAINT "user_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Table: password_reset_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "password_reset_tokens" (
    "id"          BIGSERIAL    NOT NULL,
    "user_id"     BIGINT       NOT NULL,
    "reset_token" VARCHAR(255) NOT NULL,
    "otp_code"    VARCHAR(6)   NOT NULL,
    "is_used"     BOOLEAN      NOT NULL DEFAULT FALSE,
    "used_at"     TIMESTAMP(3),
    "expires_at"  TIMESTAMP(3) NOT NULL,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "password_reset_tokens_reset_token_key" ON "password_reset_tokens" ("reset_token");
CREATE INDEX        IF NOT EXISTS "password_reset_tokens_user_id_idx"     ON "password_reset_tokens" ("user_id");
CREATE INDEX        IF NOT EXISTS "password_reset_tokens_reset_token_idx" ON "password_reset_tokens" ("reset_token");
CREATE INDEX        IF NOT EXISTS "password_reset_tokens_expires_at_idx"  ON "password_reset_tokens" ("expires_at");

ALTER TABLE "password_reset_tokens"
    ADD CONSTRAINT "password_reset_tokens_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Table: vendors
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "vendors" (
    "id"                   BIGSERIAL    NOT NULL,
    "name"                 VARCHAR(150) NOT NULL,
    "phone"                VARCHAR(15),
    "category"             VARCHAR(50),
    "referral_code"        VARCHAR(50),
    "referred_by_vendor_id" BIGINT,
    "auto_mark_enabled"    BOOLEAN      NOT NULL DEFAULT TRUE,
    "auto_send_bills"      BOOLEAN      NOT NULL DEFAULT FALSE,
    "auto_send_time"       VARCHAR(5)   DEFAULT '20:00',
    "upi_id"               VARCHAR(100),
    "bank_details"         JSONB,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"           TIMESTAMP(3) NOT NULL,
    "deleted_at"           TIMESTAMP(3),

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vendors_referral_code_key"        ON "vendors" ("referral_code");
CREATE INDEX        IF NOT EXISTS "vendors_referral_code_idx"        ON "vendors" ("referral_code");
CREATE INDEX        IF NOT EXISTS "vendors_category_idx"             ON "vendors" ("category");
CREATE INDEX        IF NOT EXISTS "vendors_phone_idx"                ON "vendors" ("phone");
CREATE INDEX        IF NOT EXISTS "vendors_referred_by_vendor_id_idx" ON "vendors" ("referred_by_vendor_id");
CREATE INDEX        IF NOT EXISTS "vendors_deleted_at_idx"           ON "vendors" ("deleted_at");

ALTER TABLE "vendors"
    ADD CONSTRAINT "vendors_referred_by_vendor_id_fkey"
    FOREIGN KEY ("referred_by_vendor_id") REFERENCES "vendors" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Table: roles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "roles" (
    "id"           BIGSERIAL    NOT NULL,
    "name"         VARCHAR(50)  NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "description"  TEXT,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "roles_name_key" ON "roles" ("name");
CREATE INDEX        IF NOT EXISTS "roles_name_idx" ON "roles" ("name");

-- ---------------------------------------------------------------------------
-- Table: permissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "permissions" (
    "id"          BIGSERIAL    NOT NULL,
    "name"        VARCHAR(100) NOT NULL,
    "resource"    VARCHAR(50)  NOT NULL,
    "action"      VARCHAR(50)  NOT NULL,
    "description" TEXT,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "permissions_name_key"            ON "permissions" ("name");
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_resource_action_key" ON "permissions" ("resource", "action");
CREATE INDEX        IF NOT EXISTS "permissions_resource_idx"        ON "permissions" ("resource");
CREATE INDEX        IF NOT EXISTS "permissions_action_idx"          ON "permissions" ("action");
CREATE INDEX        IF NOT EXISTS "permissions_name_idx"            ON "permissions" ("name");

-- ---------------------------------------------------------------------------
-- Table: role_permissions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "role_permissions" (
    "id"            BIGSERIAL    NOT NULL,
    "role_id"       BIGINT       NOT NULL,
    "permission_id" BIGINT       NOT NULL,
    "assigned_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_role_id_permission_id_key" ON "role_permissions" ("role_id", "permission_id");
CREATE INDEX        IF NOT EXISTS "role_permissions_role_id_idx"               ON "role_permissions" ("role_id");
CREATE INDEX        IF NOT EXISTS "role_permissions_permission_id_idx"         ON "role_permissions" ("permission_id");

ALTER TABLE "role_permissions"
    ADD CONSTRAINT "role_permissions_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "role_permissions"
    ADD CONSTRAINT "role_permissions_permission_id_fkey"
    FOREIGN KEY ("permission_id") REFERENCES "permissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Table: vendor_users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "vendor_users" (
    "id"               BIGSERIAL           NOT NULL,
    "vendor_id"        BIGINT              NOT NULL,
    "user_id"          BIGINT              NOT NULL,
    "role_id"          BIGINT              NOT NULL,
    "status"           "vendor_user_status" NOT NULL DEFAULT 'ACTIVE',
    "phone"            VARCHAR(15),
    "area_route_label" VARCHAR(200),
    "invited_at"       TIMESTAMP(3),
    "joined_at"        TIMESTAMP(3),
    "disabled_at"      TIMESTAMP(3),
    "removed_at"       TIMESTAMP(3),
    "created_at"       TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3)        NOT NULL,
    "deleted_at"       TIMESTAMP(3),

    CONSTRAINT "vendor_users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vendor_users_vendor_id_user_id_key" ON "vendor_users" ("vendor_id", "user_id");
CREATE INDEX        IF NOT EXISTS "vendor_users_vendor_id_idx"         ON "vendor_users" ("vendor_id");
CREATE INDEX        IF NOT EXISTS "vendor_users_user_id_idx"           ON "vendor_users" ("user_id");
CREATE INDEX        IF NOT EXISTS "vendor_users_role_id_idx"           ON "vendor_users" ("role_id");
CREATE INDEX        IF NOT EXISTS "vendor_users_status_idx"            ON "vendor_users" ("status");
CREATE INDEX        IF NOT EXISTS "vendor_users_deleted_at_idx"        ON "vendor_users" ("deleted_at");

ALTER TABLE "vendor_users"
    ADD CONSTRAINT "vendor_users_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_users"
    ADD CONSTRAINT "vendor_users_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vendor_users"
    ADD CONSTRAINT "vendor_users_role_id_fkey"
    FOREIGN KEY ("role_id") REFERENCES "roles" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Table: audit_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id"                  BIGSERIAL    NOT NULL,
    "vendor_id"           BIGINT       NOT NULL,
    "performed_by_user_id" BIGINT,
    "performed_by_role"   VARCHAR(50),
    "action"              VARCHAR(100) NOT NULL,
    "entity_type"         VARCHAR(50),
    "entity_id"           BIGINT,
    "metadata"            JSONB,
    "ip_address"          VARCHAR(45),
    "user_agent"          TEXT,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_vendor_id_idx"            ON "audit_logs" ("vendor_id");
CREATE INDEX IF NOT EXISTS "audit_logs_performed_by_user_id_idx" ON "audit_logs" ("performed_by_user_id");
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx"           ON "audit_logs" ("created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_action_idx"               ON "audit_logs" ("action");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_type_idx"          ON "audit_logs" ("entity_type");
CREATE INDEX IF NOT EXISTS "audit_logs_entity_id_idx"            ON "audit_logs" ("entity_id");

ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs"
    ADD CONSTRAINT "audit_logs_performed_by_user_id_fkey"
    FOREIGN KEY ("performed_by_user_id") REFERENCES "users" ("id") ON DELETE SET NULL ON UPDATE CASCADE;
