/**
 * voice.validator.ts — Zod validation schemas for the voice module.
 * All mutation bodies use .strict(). Query schemas allow only documented params.
 */
import { z } from 'zod';

// ── Reusable helpers ──────────────────────────────────────────────────────────

/** Coerces a numeric string to BigInt. */
const bigintString = z
  .string()
  .regex(/^\d+$/, 'Must be a numeric string')
  .transform((v) => BigInt(v));

/** All 9 supported language codes (lowercase as accepted by the API). */
const languageCodeEnum = z.enum(['en', 'hi', 'ta', 'te', 'mr', 'bn', 'kn', 'ml', 'gu']);

const templateTypeEnum = z.enum([
  'payment_reminder',
  'monthly_bill',
  'delivery_confirmation',
  'leave_confirmation',
]);

const billLanguageDefaultEnum = z.enum(['customer', 'my_language', 'english']);

const voiceActionEnum = z.enum(['mark_delivered', 'mark_leave', 'mark_all', 'adjust_quantity']);

// ── Path params ───────────────────────────────────────────────────────────────

export const userIdParamSchema = z.object({
  userId: bigintString,
});

export const vendorIdParamSchema = z.object({
  vendorId: bigintString,
});

// ── 1.1 GET language preferences — no body or query schema needed ─────────────

// ── 1.2 PATCH language preferences ───────────────────────────────────────────

export const upsertLanguagePreferenceSchema = z
  .object({
    appLanguage: languageCodeEnum.optional(),
    secondaryLanguage: languageCodeEnum.nullable().optional(),
    voiceCommandsEnabled: z.boolean().optional(),
    voiceResponsesEnabled: z.boolean().optional(),
    transliterationEnabled: z.boolean().optional(),
    billLanguageDefault: billLanguageDefaultEnum.optional(),
    preferredVoiceAccent: z.string().trim().max(20).nullable().optional(),
  })
  .strict();

// ── 2.1 GET message templates — query filter ──────────────────────────────────

export const listTemplatesQuerySchema = z
  .object({
    templateType: templateTypeEnum.optional(),
    languageCode: languageCodeEnum.optional(),
  })
  .passthrough();

// ── 2.2 PUT message template ──────────────────────────────────────────────────

export const upsertTemplateSchema = z
  .object({
    templateType: templateTypeEnum,
    languageCode: languageCodeEnum,
    content: z.string().trim().min(1).max(2000),
  })
  .strict();

// ── 2.3 POST preview ─────────────────────────────────────────────────────────

export const previewTemplateSchema = z
  .object({
    templateType: templateTypeEnum,
    languageCode: languageCodeEnum,
    content: z.string().trim().min(1).max(2000).optional(),
    sampleData: z.record(z.string(), z.string()).optional(),
  })
  .strict();

// ── 3.1 POST transcribe ───────────────────────────────────────────────────────

const MAX_AUDIO_BASE64_BYTES = 5 * 1024 * 1024; // 5 MB

export const transcribeSchema = z
  .object({
    audioData: z
      .string()
      .min(1, 'audioData is required')
      .max(Math.ceil((MAX_AUDIO_BASE64_BYTES * 4) / 3), 'audioData exceeds 5 MB limit'),
    languageCode: languageCodeEnum,
    supplyListId: bigintString,
    serviceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'serviceDate must be YYYY-MM-DD')
      .optional(),
  })
  .strict();

// ── 3.2 POST execute-command ─────────────────────────────────────────────────

export const executeCommandSchema = z
  .object({
    interpretation: z
      .object({
        action: voiceActionEnum,
        customerId: bigintString.nullable().optional(),
        quantity: z.number().positive().nullable().optional(),
      })
      .strict(),
    supplyListId: bigintString,
    serviceDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'serviceDate must be YYYY-MM-DD')
      .optional(),
    logId: bigintString.optional(),
  })
  .strict();
