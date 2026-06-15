/**
 * Zod validators for the Referral module.
 */
import { z } from 'zod';
import {
  ReferralVendorStatus,
  CreditTransactionType,
  LeaderboardPeriodType,
} from './domain/vendor-referral.types';

export const vendorIdParamSchema = z.object({
  vendorId: z.string().regex(/^\d+$/, 'vendorId must be a numeric string'),
});

// POST /vendors/:vendorId/referrals/vendor
export const createVendorReferralSchema = z
  .object({
    vendorName: z.string().max(100).trim().optional(),
    phoneNumber: z
      .string()
      .min(10)
      .max(15)
      .trim()
      .regex(/^\+?[\d]{10,15}$/, 'Must be a valid phone number (10-15 digits)'),
  })
  .strict();

// GET /vendors/:vendorId/referrals/vendor
export const listVendorReferralsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(Number(v), 50) : 20)),
  status: z.nativeEnum(ReferralVendorStatus).optional(),
});

// GET /vendors/:vendorId/credits/transactions
export const listTransactionsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(Number(v), 50) : 20)),
  type: z.nativeEnum(CreditTransactionType).optional(),
});

// POST /vendors/:vendorId/credits/redeem
export const redeemCreditSchema = z
  .object({
    redemptionType: z.enum(['subscription', 'upgrade', 'withdraw']),
    amount: z.number().positive('Amount must be greater than 0'),
  })
  .strict();

// POST /vendors/:vendorId/customers/bulk-invite
export const bulkInviteSchema = z.discriminatedUnion('targetType', [
  z
    .object({
      targetType: z.literal('all_not_on_paycycle'),
      customerIds: z.array(z.string()).optional(),
      messageLanguage: z.string().max(10).trim().optional(),
      customMessage: z.string().max(1000).trim().optional(),
      autoResend: z.boolean().optional(),
      maxAttempts: z.number().int().min(1).max(3).optional(),
    })
    .strict(),
  z
    .object({
      targetType: z.literal('specific'),
      customerIds: z
        .array(z.string())
        .min(1, 'At least one customerId required for specific target'),
      messageLanguage: z.string().max(10).trim().optional(),
      customMessage: z.string().max(1000).trim().optional(),
      autoResend: z.boolean().optional(),
      maxAttempts: z.number().int().min(1).max(3).optional(),
    })
    .strict(),
]);

// GET /vendors/:vendorId/nearby-vendors
export const nearbyVendorsQuerySchema = z.object({
  radius: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 2)),
});

// GET /vendors/:vendorId/referrals/leaderboard
export const leaderboardQuerySchema = z.object({
  period: z.nativeEnum(LeaderboardPeriodType).optional().default(LeaderboardPeriodType.MONTHLY),
  page: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(Number(v), 50) : 20)),
});

// GET /vendors/:vendorId/customer-referrals
export const paginationQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? Math.min(Number(v), 50) : 20)),
});
