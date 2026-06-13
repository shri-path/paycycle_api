-- US-002: Roles & Access Control System — schema deltas
-- Adds: vendor_staff_permissions, staff_invitations (+ status enum),
--       composite index vendor_users(vendor_id, status).
-- Authored manually because the project tracks schema via `prisma db push`
-- (no _prisma_migrations history). Apply with `prisma db push` or run this SQL.

-- ---------------------------------------------------------------------------
-- Enum: staff_invitation_status
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE "staff_invitation_status" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Table: vendor_staff_permissions (per-membership permission grants)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "vendor_staff_permissions" (
    "id"             BIGSERIAL    NOT NULL,
    "vendor_user_id" BIGINT       NOT NULL,
    "permission_key" VARCHAR(50)  NOT NULL,
    "granted"        BOOLEAN      NOT NULL DEFAULT TRUE,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_staff_permissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vendor_staff_permissions_vendor_user_id_permission_key_key"
    ON "vendor_staff_permissions" ("vendor_user_id", "permission_key");
CREATE INDEX IF NOT EXISTS "vendor_staff_permissions_vendor_user_id_idx"
    ON "vendor_staff_permissions" ("vendor_user_id");

ALTER TABLE "vendor_staff_permissions"
    ADD CONSTRAINT "vendor_staff_permissions_vendor_user_id_fkey"
    FOREIGN KEY ("vendor_user_id") REFERENCES "vendor_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Table: staff_invitations (CSPRNG token, 7-day expiry, single-use)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "staff_invitations" (
    "id"                 BIGSERIAL               NOT NULL,
    "vendor_id"          BIGINT                  NOT NULL,
    "vendor_user_id"     BIGINT                  NOT NULL,
    "invited_by_user_id" BIGINT                  NOT NULL,
    "phone"              VARCHAR(15)             NOT NULL,
    "token_hash"         VARCHAR(255)            NOT NULL,
    "status"             "staff_invitation_status" NOT NULL DEFAULT 'PENDING',
    "expires_at"         TIMESTAMP(3)            NOT NULL,
    "accepted_at"        TIMESTAMP(3),
    "revoked_at"         TIMESTAMP(3),
    "created_at"         TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3)            NOT NULL,

    CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "staff_invitations_token_hash_key"
    ON "staff_invitations" ("token_hash");
CREATE INDEX IF NOT EXISTS "staff_invitations_vendor_id_idx"
    ON "staff_invitations" ("vendor_id");
CREATE INDEX IF NOT EXISTS "staff_invitations_vendor_user_id_idx"
    ON "staff_invitations" ("vendor_user_id");
CREATE INDEX IF NOT EXISTS "staff_invitations_token_hash_idx"
    ON "staff_invitations" ("token_hash");
CREATE INDEX IF NOT EXISTS "staff_invitations_expires_at_idx"
    ON "staff_invitations" ("expires_at");
CREATE INDEX IF NOT EXISTS "staff_invitations_status_idx"
    ON "staff_invitations" ("status");

ALTER TABLE "staff_invitations"
    ADD CONSTRAINT "staff_invitations_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_invitations"
    ADD CONSTRAINT "staff_invitations_vendor_user_id_fkey"
    FOREIGN KEY ("vendor_user_id") REFERENCES "vendor_users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Composite index for staff-list query: vendor_users(vendor_id, status)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS "vendor_users_vendor_id_status_idx"
    ON "vendor_users" ("vendor_id", "status");
