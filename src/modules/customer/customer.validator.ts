import { z } from 'zod';

// ─── Params ─────────────────────────────────────────────────────────────────

export const vendorIdParamSchema = z.object({ vendorId: z.string().regex(/^\d+$/) });

export const customerParamsSchema = z.object({
  vendorId: z.string().regex(/^\d+$/),
  customerId: z.string().regex(/^\d+$/),
});

export const monthParamsSchema = z.object({
  vendorId: z.string().regex(/^\d+$/),
  customerId: z.string().regex(/^\d+$/),
  month: z.string().regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM'),
});

export const subscriptionParamsSchema = z.object({
  vendorId: z.string().regex(/^\d+$/),
  customerId: z.string().regex(/^\d+$/),
  subscriptionId: z.string().regex(/^\d+$/),
});

// ─── Create Customer ─────────────────────────────────────────────────────────

export const createCustomerSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(100),
    phone: z
      .string()
      .trim()
      .regex(/^\d{10}$/, 'Phone must be exactly 10 digits'),
    phoneCountryCode: z
      .string()
      .regex(/^\+\d{1,4}$/, 'Country code must be +1 to +9999')
      .default('+91'),
    email: z.string().email().optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    area: z.string().max(100).optional().nullable(),
    language: z.string().max(10).optional().default('en'),
    supplyListIds: z
      .array(z.string().regex(/^\d+$/, 'supplyListId must be a numeric string'))
      .optional()
      .default([]),
    startDate: z.string().date('startDate must be YYYY-MM-DD').optional().nullable(),
    creditLimit: z.number().min(0).max(9_999_999.99).optional().default(0),
    sendInvite: z.boolean().optional().default(false),
  })
  .strict();

// ─── Update Customer ─────────────────────────────────────────────────────────

export const updateCustomerSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\d{10}$/)
      .optional(),
    phoneCountryCode: z
      .string()
      .regex(/^\+\d{1,4}$/)
      .optional(),
    email: z.string().email().optional().nullable(),
    address: z.string().max(500).optional().nullable(),
    area: z.string().max(100).optional().nullable(),
    language: z.string().max(10).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();

// ─── Record Payment ──────────────────────────────────────────────────────────

export const recordPaymentSchema = z
  .object({
    amount: z.number().positive('Amount must be positive'),
    paymentDate: z.string().date('paymentDate must be YYYY-MM-DD'),
    paymentMethod: z.enum(['CASH', 'ONLINE', 'UPI', 'OTHER']),
    referenceNumber: z.string().max(100).optional().nullable(),
  })
  .strict();

// ─── Update Credit Limit ─────────────────────────────────────────────────────

export const updateCreditLimitSchema = z
  .object({
    creditLimit: z.number().min(0).max(9_999_999.99),
  })
  .strict();

// ─── Add Subscription ────────────────────────────────────────────────────────

export const addSubscriptionSchema = z
  .object({
    supplyListId: z.string().regex(/^\d+$/, 'supplyListId must be a numeric string'),
    startDate: z.string().date().optional().nullable(),
    customQuantity: z.number().positive().optional().nullable(),
    customRatePerUnit: z.number().positive().optional().nullable(),
  })
  .strict();

// ─── List Customers Query ────────────────────────────────────────────────────

export const listCustomersQuerySchema = z
  .object({
    search: z.string().max(100).optional(),
    listId: z.string().regex(/^\d+$/).optional(),
    status: z.enum(['all', 'paid', 'pending', 'overdue']).optional().default('all'),
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  })
  .passthrough();

// ─── List Payments Query ─────────────────────────────────────────────────────

export const listPaymentsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  })
  .passthrough();
