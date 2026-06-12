-- Migration: US-010 Vendor Settings
-- Creates the vendor_settings table as the single source of truth for
-- auto-mark / auto-send configuration (replaces deprecated vendor.auto_* columns).

CREATE TABLE "vendor_settings" (
    "id"                       BIGSERIAL NOT NULL,
    "vendor_id"                BIGINT    NOT NULL,
    "auto_mark_enabled"        BOOLEAN   NOT NULL DEFAULT true,
    "auto_send_bills_enabled"  BOOLEAN   NOT NULL DEFAULT false,
    "auto_send_bills_time"     VARCHAR(5) NOT NULL DEFAULT '20:00',
    "notification_preferences" JSONB     NOT NULL DEFAULT '{}',
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at"               TIMESTAMP(3),

    CONSTRAINT "vendor_settings_pkey" PRIMARY KEY ("id")
);

-- Unique constraint: one settings row per vendor
CREATE UNIQUE INDEX "vendor_settings_vendor_id_key" ON "vendor_settings"("vendor_id");

-- Indexes
CREATE INDEX "vendor_settings_vendor_id_idx"  ON "vendor_settings"("vendor_id");
CREATE INDEX "vendor_settings_deleted_at_idx" ON "vendor_settings"("deleted_at");
CREATE INDEX "vendor_settings_created_at_idx" ON "vendor_settings"("created_at");

-- Foreign key to vendors
ALTER TABLE "vendor_settings"
    ADD CONSTRAINT "vendor_settings_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: copy legacy auto_* columns from vendors into vendor_settings.
-- COALESCE handles NULLs in auto_send_time (default '20:00').
INSERT INTO vendor_settings (
    vendor_id,
    auto_mark_enabled,
    auto_send_bills_enabled,
    auto_send_bills_time,
    notification_preferences,
    created_at,
    updated_at
)
SELECT
    id,
    auto_mark_enabled,
    auto_send_bills,
    COALESCE(auto_send_time, '20:00'),
    '{}'::jsonb,
    now(),
    now()
FROM vendors
ON CONFLICT (vendor_id) DO NOTHING;
