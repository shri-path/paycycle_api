-- US-014: Referral Engine & Network Growth
-- Migration: 20260615055411_us014_referral_engine

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE "vendor_referral_status" AS ENUM ('PENDING', 'SIGNED_UP', 'QUALIFIED', 'REWARDED');
CREATE TYPE "customer_referral_status" AS ENUM ('SENT', 'SIGNED_UP', 'QUALIFIED', 'REWARDED');
CREATE TYPE "vendor_reward_type" AS ENUM ('SUBSCRIPTION_DISCOUNT', 'CASH_CREDIT', 'FREE_MONTHS');
CREATE TYPE "customer_reward_type" AS ENUM ('BILL_DISCOUNT', 'FREE_DAYS', 'CASH_CREDIT');
CREATE TYPE "credit_transaction_type" AS ENUM ('EARNED', 'USED', 'EXPIRED', 'ADJUSTMENT');
CREATE TYPE "credit_source_type" AS ENUM ('VENDOR_REFERRAL', 'CUSTOMER_REFERRAL', 'SUBSCRIPTION_PAYMENT', 'MANUAL');
CREATE TYPE "referral_reward_kind" AS ENUM ('SIGNUP_BONUS', 'MILESTONE_10', 'MILESTONE_50', 'REVENUE_SHARE', 'CUSTOMER_REFERRAL');
CREATE TYPE "referral_invite_status" AS ENUM ('SENT', 'DELIVERED', 'SIGNED_UP', 'FAILED');
CREATE TYPE "leaderboard_period_type" AS ENUM ('WEEKLY', 'MONTHLY', 'ALL_TIME');

-- =============================================================================
-- TABLE: vendor_referrals
-- =============================================================================

CREATE TABLE "vendor_referrals" (
    "id" BIGSERIAL NOT NULL,
    "referrer_vendor_id" BIGINT NOT NULL,
    "referee_vendor_id" BIGINT,
    "referral_code" VARCHAR(50) NOT NULL,
    "status" "vendor_referral_status" NOT NULL DEFAULT 'PENDING',
    "reward_type" "vendor_reward_type",
    "reward_amount" DECIMAL(10,2),
    "referee_name" VARCHAR(100),
    "referee_phone" VARCHAR(15),
    -- delta #B: milestone tracking columns
    "signup_date" DATE,
    "first_customer_date" DATE,
    "milestone_10_at" TIMESTAMPTZ,
    "milestone_50_at" TIMESTAMPTZ,
    "revenue_share_until" DATE,
    "clawed_back_at" TIMESTAMPTZ,
    -- delta #G: soft delete
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "vendor_referrals_pkey" PRIMARY KEY ("id"),
    -- delta #D: self-referral block
    CONSTRAINT "chk_vendor_referrals_no_self" CHECK (
        "referee_vendor_id" IS NULL OR "referee_vendor_id" <> "referrer_vendor_id"
    )
);

-- delta #C: one referrer per referee (partial unique)
CREATE UNIQUE INDEX "uq_vendor_referrals_referee"
    ON "vendor_referrals" ("referee_vendor_id")
    WHERE "referee_vendor_id" IS NOT NULL AND "deleted_at" IS NULL;

CREATE INDEX "vendor_referrals_referrer_vendor_id_idx" ON "vendor_referrals" ("referrer_vendor_id");
CREATE INDEX "vendor_referrals_referee_vendor_id_idx" ON "vendor_referrals" ("referee_vendor_id");
CREATE INDEX "vendor_referrals_referral_code_idx" ON "vendor_referrals" ("referral_code");
CREATE INDEX "vendor_referrals_status_idx" ON "vendor_referrals" ("status");
CREATE INDEX "vendor_referrals_created_at_idx" ON "vendor_referrals" ("created_at");
CREATE INDEX "vendor_referrals_deleted_at_idx" ON "vendor_referrals" ("deleted_at");
CREATE INDEX "vendor_referrals_referrer_status_idx" ON "vendor_referrals" ("referrer_vendor_id", "status");

-- =============================================================================
-- TABLE: customer_referrals
-- =============================================================================

CREATE TABLE "customer_referrals" (
    "id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "referrer_customer_id" BIGINT NOT NULL,
    "referee_customer_id" BIGINT NOT NULL,
    "status" "customer_referral_status" NOT NULL DEFAULT 'SENT',
    "reward_type" "customer_reward_type",
    "referrer_reward_amount" DECIMAL(10,2),
    "qualified_at" TIMESTAMPTZ,
    -- delta #G: soft delete
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "customer_referrals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_customer_referrals_no_self" CHECK ("referee_customer_id" <> "referrer_customer_id")
);

CREATE INDEX "customer_referrals_vendor_id_idx" ON "customer_referrals" ("vendor_id");
CREATE INDEX "customer_referrals_referrer_customer_id_idx" ON "customer_referrals" ("referrer_customer_id");
CREATE INDEX "customer_referrals_referee_customer_id_idx" ON "customer_referrals" ("referee_customer_id");
CREATE INDEX "customer_referrals_status_idx" ON "customer_referrals" ("status");
CREATE INDEX "customer_referrals_created_at_idx" ON "customer_referrals" ("created_at");
CREATE INDEX "customer_referrals_deleted_at_idx" ON "customer_referrals" ("deleted_at");
CREATE INDEX "customer_referrals_vendor_status_idx" ON "customer_referrals" ("vendor_id", "status");

-- =============================================================================
-- TABLE: vendor_credits  (one row per vendor)
-- =============================================================================

CREATE TABLE "vendor_credits" (
    "id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "available_credits" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lifetime_credits_earned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "lifetime_credits_used" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "vendor_credits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "vendor_credits_vendor_id_key" UNIQUE ("vendor_id"),
    CONSTRAINT "chk_vendor_credits_non_negative" CHECK ("available_credits" >= 0)
);

CREATE INDEX "vendor_credits_vendor_id_idx" ON "vendor_credits" ("vendor_id");
CREATE INDEX "vendor_credits_created_at_idx" ON "vendor_credits" ("created_at");

-- =============================================================================
-- TABLE: credit_transactions (immutable ledger; INSERT only)
-- =============================================================================

CREATE TABLE "credit_transactions" (
    "id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "vendor_credit_id" BIGINT NOT NULL,
    "transaction_type" "credit_transaction_type" NOT NULL,
    "reward_kind" "referral_reward_kind",
    "amount" DECIMAL(10,2) NOT NULL,
    "balance_after" DECIMAL(12,2) NOT NULL,
    "source_type" "credit_source_type",
    "source_id" BIGINT,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chk_credit_transactions_amount_positive" CHECK ("amount" > 0)
);

CREATE INDEX "credit_transactions_vendor_id_idx" ON "credit_transactions" ("vendor_id");
CREATE INDEX "credit_transactions_vendor_credit_id_idx" ON "credit_transactions" ("vendor_credit_id");
CREATE INDEX "credit_transactions_transaction_type_idx" ON "credit_transactions" ("transaction_type");
CREATE INDEX "credit_transactions_created_at_idx" ON "credit_transactions" ("created_at");

ALTER TABLE "credit_transactions"
    ADD CONSTRAINT "credit_transactions_vendor_credit_id_fkey"
    FOREIGN KEY ("vendor_credit_id") REFERENCES "vendor_credits"("id") ON DELETE CASCADE;

-- =============================================================================
-- TABLE: referral_customer_invites (delta #E — growth outreach table)
-- =============================================================================

CREATE TABLE "referral_customer_invites" (
    "id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "customer_id" BIGINT,
    "phone" VARCHAR(15) NOT NULL,
    "status" "referral_invite_status" NOT NULL DEFAULT 'SENT',
    "message_language" VARCHAR(10),
    "attempt_count" INT NOT NULL DEFAULT 1,
    "auto_resend" BOOLEAN NOT NULL DEFAULT TRUE,
    "max_attempts" INT NOT NULL DEFAULT 3,
    "sent_at" TIMESTAMPTZ,
    "last_attempt_at" TIMESTAMPTZ,
    "signed_up_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "referral_customer_invites_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "referral_customer_invites_vendor_status_idx" ON "referral_customer_invites" ("vendor_id", "status");
CREATE INDEX "referral_customer_invites_vendor_id_idx" ON "referral_customer_invites" ("vendor_id");
CREATE INDEX "referral_customer_invites_phone_idx" ON "referral_customer_invites" ("phone");
CREATE INDEX "referral_customer_invites_deleted_at_idx" ON "referral_customer_invites" ("deleted_at");
CREATE INDEX "referral_customer_invites_created_at_idx" ON "referral_customer_invites" ("created_at");

-- =============================================================================
-- TABLE: referral_leaderboard (read model, recomputed by cron)
-- =============================================================================

CREATE TABLE "referral_leaderboard" (
    "id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "period_type" "leaderboard_period_type" NOT NULL,
    "period_start" DATE NOT NULL,
    "rank_position" INT NOT NULL,
    "total_referrals" INT NOT NULL DEFAULT 0,
    "qualified_referrals" INT NOT NULL DEFAULT 0,
    "reward_earned" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT "referral_leaderboard_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "referral_leaderboard_vendor_period_key" UNIQUE ("vendor_id", "period_type", "period_start")
);

CREATE INDEX "referral_leaderboard_vendor_id_idx" ON "referral_leaderboard" ("vendor_id");
CREATE INDEX "referral_leaderboard_period_idx" ON "referral_leaderboard" ("period_type", "period_start");
CREATE INDEX "referral_leaderboard_rank_idx" ON "referral_leaderboard" ("rank_position");
CREATE INDEX "referral_leaderboard_created_at_idx" ON "referral_leaderboard" ("created_at");
