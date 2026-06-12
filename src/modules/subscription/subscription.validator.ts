/**
 * Zod validation schemas for the Subscription & Pricing Management module.
 */
import { z } from 'zod';

export const vendorIdParamSchema = z.object({
  vendorId: z.string().regex(/^\d+$/, 'vendorId must be numeric'),
});

export const upgradeSchema = z
  .object({
    newPlanId: z.string().regex(/^\d+$/, 'newPlanId must be a numeric string').transform(String),
    billingCycle: z.enum(['MONTHLY', 'YEARLY']),
  })
  .strict();

export const renewSchema = z
  .object({
    billingCycle: z.enum(['MONTHLY', 'YEARLY']),
  })
  .strict();

export const cancelSchema = z.object({}).strict();

export const autoRenewalSchema = z
  .object({
    autoRenewal: z.boolean(),
  })
  .strict();

export const paginationQuerySchema = z
  .object({
    page: z
      .string()
      .optional()
      .transform((v) => (v ? parseInt(v, 10) : 1))
      .pipe(z.number().int().min(1)),
    limit: z
      .string()
      .optional()
      .transform((v) => (v ? parseInt(v, 10) : 20))
      .pipe(z.number().int().min(1).max(50)),
  })
  .passthrough();

export type UpgradeInput = z.infer<typeof upgradeSchema>;
export type RenewInput = z.infer<typeof renewSchema>;
export type AutoRenewalInput = z.infer<typeof autoRenewalSchema>;
export type PaginationQuery = { page: number; limit: number };
