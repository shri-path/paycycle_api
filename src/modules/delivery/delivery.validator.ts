import { z } from 'zod';

const bigIntIdString = z.string().regex(/^\d+$/, 'Invalid ID format');
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), 'Invalid calendar date');
const monthString = z.string().regex(/^\d{4}-\d{2}$/, 'Month must be YYYY-MM');

// ============================================================
// Path parameter schemas
// ============================================================

export const vendorIdParamSchema = z.object({ vendorId: bigIntIdString }).passthrough();

export const deliveryIdParamSchema = z
  .object({ vendorId: bigIntIdString, deliveryId: bigIntIdString })
  .passthrough();

export const leaveIdParamSchema = z
  .object({ vendorId: bigIntIdString, leaveId: bigIntIdString })
  .passthrough();

export const listIdParamSchema = z
  .object({ vendorId: bigIntIdString, listId: bigIntIdString })
  .passthrough();

export const dateParamSchema = z
  .object({ vendorId: bigIntIdString, date: dateString })
  .passthrough();

// ============================================================
// Query schemas (.passthrough for query-builder compatibility)
// ============================================================

export const todayQuerySchema = z
  .object({
    date: dateString.optional(),
    listId: bigIntIdString.optional(),
    staffId: bigIntIdString.optional(),
  })
  .passthrough();

export const listDeliveriesQuerySchema = z
  .object({
    date: dateString.optional(),
    status: z.enum(['PENDING', 'DELIVERED', 'LEAVE', 'AUTO_MARKED', 'CANCELLED']).optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .passthrough();

export const leavesQuerySchema = z
  .object({
    status: z.enum(['today', 'upcoming']).optional(),
    staffId: bigIntIdString.optional(),
  })
  .passthrough();

export const calendarQuerySchema = z
  .object({
    month: monthString,
    listId: bigIntIdString.optional(),
    customerId: bigIntIdString.optional(),
  })
  .passthrough();

// ============================================================
// Mutation schemas (.strict)
// ============================================================

export const markDeliverySchema = z
  .object({
    status: z.enum(['DELIVERED', 'LEAVE']),
    quantity: z.number().nonnegative().finite().optional(),
  })
  .strict();
export type MarkDeliveryInput = z.infer<typeof markDeliverySchema>;

export const markBulkSchema = z
  .object({
    supplyListId: bigIntIdString,
    date: dateString,
    status: z.literal('DELIVERED'),
    excludeDeliveryIds: z.array(bigIntIdString).max(1000).optional(),
  })
  .strict();
export type MarkBulkInput = z.infer<typeof markBulkSchema>;

export const addExtraChargeSchema = z
  .object({
    dailySupplyId: bigIntIdString,
    amount: z
      .number()
      .finite()
      .refine((n) => n !== 0, 'amount must be non-zero')
      .refine((n) => Math.abs(n) >= 0.01, { message: 'Amount must be at least 0.01 (one cent)' }),
    comment: z.string().trim().min(1, 'comment is required').max(500),
  })
  .strict();
export type AddExtraChargeInput = z.infer<typeof addExtraChargeSchema>;

export const createLeaveSchema = z
  .object({
    customerId: bigIntIdString,
    supplyListIds: z.array(bigIntIdString).min(1, 'at least one list'),
    startDate: dateString,
    endDate: dateString,
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((d) => d.endDate >= d.startDate, {
    message: 'endDate must be on or after startDate',
    path: ['endDate'],
  });
export type CreateLeaveInput = z.infer<typeof createLeaveSchema>;

export const generateSchema = z.object({ date: dateString.optional() }).strict();
export type GenerateInput = z.infer<typeof generateSchema>;
