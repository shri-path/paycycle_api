import { z } from 'zod';

const bigIntIdString = z.string().regex(/^\d+$/, 'Invalid ID format');
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), 'Invalid calendar date');

// ============================================================
// Path parameter schemas
// ============================================================

export const vendorIdParamSchema = z.object({ vendorId: bigIntIdString }).passthrough();

// ============================================================
// Query schemas (.passthrough for forward-compat query params)
// ============================================================

export const listAuditLogsQuerySchema = z
  .object({
    staffId: bigIntIdString.optional(),
    customerId: bigIntIdString.optional(),
    actionType: z.string().trim().min(1).max(100).optional(),
    entityType: z.string().trim().min(1).max(50).optional(),
    startDate: dateString.optional(),
    endDate: dateString.optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .passthrough();

export const staffSummaryQuerySchema = z
  .object({
    staffId: bigIntIdString.optional(),
    startDate: dateString.optional(),
    endDate: dateString.optional(),
  })
  .passthrough();

export const conflictsQuerySchema = z.object({}).passthrough();

// ============================================================
// Body schemas (strict for mutations / commands)
// ============================================================

export const exportAuditLogsBodySchema = z
  .object({
    format: z.literal('csv'),
    staffId: bigIntIdString.optional(),
    actionType: z.string().trim().min(1).max(100).optional(),
    startDate: dateString.optional(),
    endDate: dateString.optional(),
  })
  .strict();

export type ListAuditLogsQueryInput = z.infer<typeof listAuditLogsQuerySchema>;
export type StaffSummaryQueryInput = z.infer<typeof staffSummaryQuerySchema>;
export type ExportAuditLogsInput = z.infer<typeof exportAuditLogsBodySchema>;
