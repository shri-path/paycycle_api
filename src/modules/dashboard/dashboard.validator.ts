/**
 * Zod validation schemas for Dashboard endpoints.
 */
import { z } from 'zod';

export const vendorIdParamSchema = z.object({
  vendorId: z.string().regex(/^\d+$/, 'vendorId must be a numeric string'),
});

export const staffIdParamSchema = z.object({
  vendorId: z.string().regex(/^\d+$/, 'vendorId must be a numeric string'),
  staffId: z.string().regex(/^\d+$/, 'staffId must be a numeric string'),
});

/** YYYY-MM month param */
export const ownerDashboardQuerySchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-\d{2}$/, 'month must be YYYY-MM format')
      .optional(),
  })
  .passthrough();

/** YYYY-MM-DD date param */
export const supplyForecastQuerySchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD format')
      .optional(),
    days: z
      .string()
      .optional()
      .transform((v) => (v !== undefined ? parseInt(v, 10) : 7))
      .pipe(z.number().int().min(1).max(30)),
    supplyType: z.string().optional(),
  })
  .passthrough();

export const outstandingAgingQuerySchema = z
  .object({
    priority: z.enum(['high', 'medium', 'low', 'all']).optional(),
    page: z
      .string()
      .optional()
      .transform((v) => (v !== undefined ? parseInt(v, 10) : 1))
      .pipe(z.number().int().min(1)),
    limit: z
      .string()
      .optional()
      .transform((v) => (v !== undefined ? parseInt(v, 10) : 20))
      .pipe(z.number().int().min(1).max(100)),
  })
  .passthrough();
