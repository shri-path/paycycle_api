/**
 * Zod validation schemas for VendorSettings endpoints.
 */
import { z } from 'zod';

export const vendorIdParamSchema = z.object({
  vendorId: z.string().regex(/^\d+$/, 'vendorId must be a numeric string'),
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
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Request body must contain at least one field to update',
  });
