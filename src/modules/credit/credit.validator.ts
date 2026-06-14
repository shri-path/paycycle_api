import { z } from 'zod';
import { CreditTypeEnum, CreditBreachActionEnum } from './domain/credit.types';

// ── Path params ───────────────────────────────────────────────────────────────

export const vendorIdParamSchema = z.object({
  vendorId: z.string().min(1),
});

export const customerParamsSchema = z.object({
  vendorId: z.string().min(1),
  customerId: z.string().min(1),
});

// ── Command bodies ────────────────────────────────────────────────────────────

export const setCreditSettingsSchema = z
  .object({
    creditType: z.nativeEnum(CreditTypeEnum).optional(),
    creditLimit: z.number().finite().min(0).optional(),
    warningThreshold: z.number().int().min(0).max(100).optional(),
    actionOnBreach: z.nativeEnum(CreditBreachActionEnum).optional(),
    minimumBalanceWarning: z.number().finite().min(0).nullable().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.creditType !== undefined ||
      data.creditLimit !== undefined ||
      data.warningThreshold !== undefined ||
      data.actionOnBreach !== undefined ||
      data.minimumBalanceWarning !== undefined,
    { message: 'At least one field must be provided' }
  );

export const enablePrepaidSchema = z
  .object({
    clearOutstandingFirst: z.boolean().default(true),
    minimumBalanceWarning: z.number().finite().min(0).optional(),
    message: z.string().max(500).optional(),
  })
  .strict();

export const singleReminderSchema = z
  .object({
    customMessage: z.string().max(500).optional(),
  })
  .strict();

export const sendBulkSchema = z.discriminatedUnion('target', [
  z
    .object({
      target: z.literal('all_overdue'),
      customMessage: z.string().max(500).optional(),
    })
    .strict(),
  z
    .object({
      target: z.literal('selected'),
      customerIds: z.array(z.string().min(1)).min(1),
      customMessage: z.string().max(500).optional(),
    })
    .strict(),
]);

export const updateReminderConfigSchema = z
  .object({
    autoRemindersEnabled: z.boolean().optional(),
    schedule3Days: z.boolean().optional(),
    schedule15Days: z.boolean().optional(),
    schedule30Days: z.boolean().optional(),
    reminderTemplate: z.string().max(2000).nullable().optional(),
    excludedCustomerIds: z.array(z.string().regex(/^\d+$/)).optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.autoRemindersEnabled !== undefined ||
      data.schedule3Days !== undefined ||
      data.schedule15Days !== undefined ||
      data.schedule30Days !== undefined ||
      data.reminderTemplate !== undefined ||
      data.excludedCustomerIds !== undefined,
    { message: 'At least one field must be provided' }
  );

// ── Query params ──────────────────────────────────────────────────────────────

export const prioritySortQuerySchema = z
  .object({
    sort: z
      .enum(['oldest_first', 'amount_desc', 'utilization_desc', 'score_asc'])
      .optional()
      .default('oldest_first'),
  })
  .passthrough();

export const analyticsQuerySchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/, 'month must be in YYYY-MM format')
      .optional(),
  })
  .passthrough();

export const reminderHistoryQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .passthrough();

// ── Inferred types ────────────────────────────────────────────────────────────

export type SetCreditSettingsInput = z.infer<typeof setCreditSettingsSchema>;
export type EnablePrepaidInput = z.infer<typeof enablePrepaidSchema>;
export type SingleReminderInput = z.infer<typeof singleReminderSchema>;
export type SendBulkInput = z.infer<typeof sendBulkSchema>;
export type UpdateReminderConfigInput = z.infer<typeof updateReminderConfigSchema>;
