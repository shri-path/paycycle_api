-- US-013: Multi-Language & Voice Interface
-- Creates enums SupportedLanguage, BillLanguagePolicy, MessageTemplateType
-- and tables language_preferences, message_templates, voice_command_logs

-- CreateEnum
CREATE TYPE "supported_language" AS ENUM ('EN', 'HI', 'TA', 'TE', 'MR', 'BN', 'KN', 'ML', 'GU');

-- CreateEnum
CREATE TYPE "bill_language_policy" AS ENUM ('CUSTOMER', 'MY_LANGUAGE', 'ENGLISH');

-- CreateEnum
CREATE TYPE "message_template_type" AS ENUM ('PAYMENT_REMINDER', 'MONTHLY_BILL', 'DELIVERY_CONFIRMATION', 'LEAVE_CONFIRMATION');

-- CreateTable: language_preferences (1:1 with users)
CREATE TABLE "language_preferences" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "app_language" "supported_language" NOT NULL DEFAULT 'EN',
    "secondary_language" "supported_language",
    "voice_commands_enabled" BOOLEAN NOT NULL DEFAULT false,
    "voice_responses_enabled" BOOLEAN NOT NULL DEFAULT false,
    "transliteration_enabled" BOOLEAN NOT NULL DEFAULT false,
    "bill_language_default" "bill_language_policy" NOT NULL DEFAULT 'CUSTOMER',
    "preferred_voice_accent" VARCHAR(20),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "language_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable: message_templates
CREATE TABLE "message_templates" (
    "id" BIGSERIAL NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "template_type" "message_template_type" NOT NULL,
    "language_code" "supported_language" NOT NULL,
    "content" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "deleted_at" TIMESTAMPTZ,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable: voice_command_logs (INSERT-only analytics)
CREATE TABLE "voice_command_logs" (
    "id" BIGSERIAL NOT NULL,
    "user_id" BIGINT NOT NULL,
    "vendor_id" BIGINT NOT NULL,
    "language_code" "supported_language" NOT NULL,
    "supply_list_id" BIGINT,
    "customer_id" BIGINT,
    "transcription" TEXT,
    "detected_action" VARCHAR(40),
    "confidence_score" DECIMAL(5,2),
    "was_executed" BOOLEAN NOT NULL DEFAULT false,
    "execution_result" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_command_logs_pkey" PRIMARY KEY ("id")
);

-- CreateUniqueIndex: language_preferences.user_id
CREATE UNIQUE INDEX "language_preferences_user_id_key" ON "language_preferences"("user_id");

-- CreateUniqueIndex: message_templates (vendorId, templateType, languageCode)
CREATE UNIQUE INDEX "message_templates_vendor_id_template_type_language_code_key" ON "message_templates"("vendor_id", "template_type", "language_code");

-- CreateIndex: language_preferences
CREATE INDEX "language_preferences_user_id_idx" ON "language_preferences"("user_id");
CREATE INDEX "language_preferences_app_language_idx" ON "language_preferences"("app_language");

-- CreateIndex: message_templates
CREATE INDEX "message_templates_vendor_id_idx" ON "message_templates"("vendor_id");
CREATE INDEX "message_templates_template_type_idx" ON "message_templates"("template_type");
CREATE INDEX "message_templates_language_code_idx" ON "message_templates"("language_code");
CREATE INDEX "message_templates_deleted_at_idx" ON "message_templates"("deleted_at");
CREATE INDEX "message_templates_created_at_idx" ON "message_templates"("created_at");

-- CreateIndex: voice_command_logs
CREATE INDEX "voice_command_logs_user_id_idx" ON "voice_command_logs"("user_id");
CREATE INDEX "voice_command_logs_vendor_id_idx" ON "voice_command_logs"("vendor_id");
CREATE INDEX "voice_command_logs_detected_action_idx" ON "voice_command_logs"("detected_action");
CREATE INDEX "voice_command_logs_created_at_idx" ON "voice_command_logs"("created_at");

-- AddForeignKey: language_preferences → users
ALTER TABLE "language_preferences" ADD CONSTRAINT "language_preferences_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: message_templates → vendors
ALTER TABLE "message_templates" ADD CONSTRAINT "message_templates_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: voice_command_logs → users
ALTER TABLE "voice_command_logs" ADD CONSTRAINT "voice_command_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: voice_command_logs → vendors
ALTER TABLE "voice_command_logs" ADD CONSTRAINT "voice_command_logs_vendor_id_fkey"
    FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
