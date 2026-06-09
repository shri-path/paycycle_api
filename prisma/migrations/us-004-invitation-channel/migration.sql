-- US-004: Staff Management — invitation channel + resend tracking
-- Adds to staff_invitations: sent_via (channel enum), sent_count, last_sent_at.
-- Additive and non-breaking — every column is nullable or defaulted; existing
-- rows are backfilled so last_sent_at reflects their original send (created_at).
-- Authored manually because the project tracks schema via `prisma db push`
-- (no _prisma_migrations history). Apply with `prisma db push` or run this SQL.

-- ---------------------------------------------------------------------------
-- Enum: invitation_channel (WhatsApp / SMS delivery channel)
-- ---------------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE "invitation_channel" AS ENUM ('WHATSAPP', 'SMS');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Columns on staff_invitations
-- ---------------------------------------------------------------------------
ALTER TABLE "staff_invitations"
    ADD COLUMN IF NOT EXISTS "sent_via" "invitation_channel";
ALTER TABLE "staff_invitations"
    ADD COLUMN IF NOT EXISTS "sent_count" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "staff_invitations"
    ADD COLUMN IF NOT EXISTS "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ---------------------------------------------------------------------------
-- Backfill: existing rows were sent exactly once, at creation time.
-- (Default already set sent_count=1; align last_sent_at with the original send.)
-- ---------------------------------------------------------------------------
UPDATE "staff_invitations"
    SET "last_sent_at" = "created_at"
    WHERE "last_sent_at" IS NOT NULL;
