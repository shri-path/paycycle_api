/**
 * Zod validation schemas for VendorSettings endpoints.
 */
import { z } from 'zod';

export const vendorIdParamSchema = z.object({
  vendorId: z.string().regex(/^\d+$/, 'vendorId must be a numeric string'),
});

export const operationIdParamSchema = z.object({
  vendorId: z.string().regex(/^\d+$/, 'vendorId must be a numeric string'),
  operationId: z.string().regex(/^\d+$/, 'operationId must be a numeric string'),
});

/** PATCH /settings — strict: all optional but at least one required. */
export const updateVendorSettingsSchema = z
  .object({
    autoMarkEnabled: z.boolean().optional(),
    autoSendBillsEnabled: z.boolean().optional(),
    autoSendBillsTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'autoSendBillsTime must be HH:mm (00:00–23:59)')
      .optional(),
    notificationPreferences: z
      .record(z.unknown())
      .refine((v) => !Array.isArray(v), {
        message: 'notificationPreferences must be a plain object, not an array',
      })
      .optional(),
    // US-011 new fields
    defaultCreditLimit: z.number().min(0, 'defaultCreditLimit must be >= 0').nullable().optional(),
    defaultCreditPeriodDays: z
      .number()
      .int('defaultCreditPeriodDays must be an integer')
      .min(1, 'defaultCreditPeriodDays must be >= 1')
      .max(365, 'defaultCreditPeriodDays must be <= 365')
      .nullable()
      .optional(),
    bulkOperationConcurrencyLimit: z
      .number()
      .int('bulkOperationConcurrencyLimit must be an integer')
      .min(1, 'bulkOperationConcurrencyLimit must be >= 1')
      .max(500, 'bulkOperationConcurrencyLimit must be <= 500')
      .optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Request body must contain at least one field to update',
  });

/** PATCH /notification-preferences */
export const updateNotificationPreferencesSchema = z
  .object({
    notificationPreferences: z.record(z.unknown()).refine((v) => !Array.isArray(v), {
      message: 'notificationPreferences must be a plain object, not an array',
    }),
  })
  .strict();

/** POST /bulk-operations/mark-leave */
export const bulkMarkLeaveSchema = z
  .object({
    subscriptionIds: z
      .array(z.string().regex(/^\d+$/, 'Each subscriptionId must be numeric'))
      .min(1, 'subscriptionIds must have at least one entry')
      .max(500, 'Cannot target more than 500 subscriptions in one request')
      .optional(),
    all: z.boolean().optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format'),
    reason: z.string().trim().max(500, 'reason must be at most 500 characters').optional(),
  })
  .strict()
  .refine(
    (body) => {
      const hasIds = body.subscriptionIds !== undefined && body.subscriptionIds.length > 0;
      const hasAll = body.all === true;
      // Exactly one of: subscriptionIds or all
      return (hasIds && !hasAll) || (!hasIds && hasAll);
    },
    {
      message:
        'Provide either subscriptionIds (non-empty) or all: true, but not both and not neither',
    }
  );

/** POST /bulk-operations/adjust-rate */
export const bulkAdjustRateSchema = z
  .object({
    subscriptionIds: z
      .array(z.string().regex(/^\d+$/, 'Each subscriptionId must be numeric'))
      .min(1, 'subscriptionIds must have at least one entry')
      .max(500, 'Cannot target more than 500 subscriptions in one request')
      .optional(),
    all: z.boolean().optional(),
    newRate: z.number().min(0, 'newRate must be >= 0'),
    effectiveDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'effectiveDate must be in YYYY-MM-DD format'),
    notifyCustomers: z.boolean().optional(),
  })
  .strict()
  .refine(
    (body) => {
      const hasIds = body.subscriptionIds !== undefined && body.subscriptionIds.length > 0;
      const hasAll = body.all === true;
      return (hasIds && !hasAll) || (!hasIds && hasAll);
    },
    {
      message:
        'Provide either subscriptionIds (non-empty) or all: true, but not both and not neither',
    }
  );

/** POST /bulk-operations/send-reminders */
export const bulkSendRemindersSchema = z
  .object({
    customerIds: z
      .array(z.string().regex(/^\d+$/, 'Each customerId must be numeric'))
      .min(1, 'customerIds must have at least one entry')
      .max(500, 'Cannot target more than 500 customers in one request')
      .optional(),
    all: z.boolean().optional(),
    messageTemplate: z
      .string()
      .trim()
      .max(1000, 'messageTemplate must be at most 1000 characters')
      .optional(),
  })
  .strict()
  .refine(
    (body) => {
      const hasIds = body.customerIds !== undefined && body.customerIds.length > 0;
      const hasAll = body.all === true;
      return (hasIds && !hasAll) || (!hasIds && hasAll);
    },
    { message: 'Provide either customerIds (non-empty) or all: true, but not both and not neither' }
  );
