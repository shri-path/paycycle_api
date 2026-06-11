import { z } from 'zod';
import { SupplyFrequency } from '@prisma/client';

// ============================================================
// Reusable field schemas
// ============================================================

const bigIntIdString = z.string().regex(/^\d+$/, 'Invalid ID format');

const ALLOWED_UNITS = ['ltr', 'kg', 'pieces', 'grams', 'numbers', 'packets'] as const;

const unitField = z
  .string()
  .trim()
  .toLowerCase()
  .refine((v) => (ALLOWED_UNITS as readonly string[]).includes(v), {
    message: `unit must be one of: ${ALLOWED_UNITS.join(', ')}`,
  });

const nameField = z.string().trim().min(1, 'name is required').max(100, 'name too long');
const supplyTypeField = z.string().trim().max(50, 'supplyType too long');
const timeField = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'startTime must be HH:mm');
const quantityField = z.number().nonnegative('must be >= 0').finite();
const rateField = z.number().nonnegative('must be >= 0').finite();

const frequencyField = z.nativeEnum(SupplyFrequency, {
  errorMap: () => ({
    message: `frequency must be one of: ${Object.values(SupplyFrequency).join(', ')}`,
  }),
});

const weeklyDays = z.array(z.number().int().min(1).max(7)).min(1, 'at least one day is required');
const monthlyDays = z.array(z.number().int().min(1).max(31)).min(1, 'at least one day is required');

// ============================================================
// Path parameter schemas
// ============================================================

export const vendorIdParamSchema = z.object({ vendorId: bigIntIdString }).passthrough();

export const listIdParamSchema = z
  .object({ vendorId: bigIntIdString, listId: bigIntIdString })
  .passthrough();

export const listStaffParamSchema = z
  .object({ vendorId: bigIntIdString, listId: bigIntIdString, staffId: bigIntIdString })
  .passthrough();

export const subscriptionParamSchema = z
  .object({ vendorId: bigIntIdString, listId: bigIntIdString, subscriptionId: bigIntIdString })
  .passthrough();

// ============================================================
// Query schemas (.passthrough for the dynamic query-builder)
// ============================================================

export const listSupplyListsQuerySchema = z
  .object({
    status: z.enum(['active', 'archived']).optional(),
    staffId: bigIntIdString.optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .passthrough();

export const listCustomersQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    status: z.enum(['active', 'paused', 'ended']).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .passthrough();

export const availableCustomersQuerySchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .passthrough();

// ============================================================
// Mutation schemas (.strict)
// ============================================================

/**
 * POST /supply-lists — discriminated on frequency so the schedule-day rule is
 * enforced structurally (WEEKLY → frequencyDays 1..7; MONTHLY → 1..31; DAILY → none).
 */
const createListBase = {
  name: nameField,
  supplyType: supplyTypeField.optional(),
  unit: unitField,
  defaultQuantity: quantityField.optional(),
  defaultRatePerUnit: rateField.optional(),
  startTime: timeField.optional(),
  staffIds: z.array(bigIntIdString).max(50).optional(),
  primaryStaffId: bigIntIdString.optional(),
};

const primaryWithinStaff = (data: {
  staffIds?: string[] | undefined;
  primaryStaffId?: string | undefined;
}): boolean =>
  data.primaryStaffId === undefined ||
  (data.staffIds !== undefined && data.staffIds.includes(data.primaryStaffId));

export const createSupplyListSchema = z
  .discriminatedUnion('frequency', [
    z.object({ ...createListBase, frequency: z.literal(SupplyFrequency.DAILY) }).strict(),
    z
      .object({
        ...createListBase,
        frequency: z.literal(SupplyFrequency.WEEKLY),
        frequencyDays: weeklyDays,
      })
      .strict(),
    z
      .object({
        ...createListBase,
        frequency: z.literal(SupplyFrequency.MONTHLY),
        frequencyDays: monthlyDays,
      })
      .strict(),
  ])
  .refine(primaryWithinStaff, {
    message: 'primaryStaffId must be one of staffIds',
    path: ['primaryStaffId'],
  });

export type CreateSupplyListInput = z.infer<typeof createSupplyListSchema>;

/** PATCH /supply-lists/:listId — all optional, ≥1 field. */
export const updateSupplyListSchema = z
  .object({
    name: nameField.optional(),
    supplyType: supplyTypeField.nullable().optional(),
    unit: unitField.optional(),
    defaultQuantity: quantityField.nullable().optional(),
    defaultRatePerUnit: rateField.nullable().optional(),
    startTime: timeField.nullable().optional(),
    frequency: frequencyField.optional(),
    frequencyDays: z.array(z.number().int().min(1).max(31)).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  })
  .refine(
    (data) =>
      data.frequency !== SupplyFrequency.WEEKLY ||
      (data.frequencyDays !== undefined && data.frequencyDays.every((d) => d >= 1 && d <= 7)),
    { message: 'WEEKLY frequency requires frequencyDays in 1..7', path: ['frequencyDays'] }
  )
  .refine(
    (data) =>
      data.frequency !== SupplyFrequency.MONTHLY ||
      (data.frequencyDays !== undefined && data.frequencyDays.every((d) => d >= 1 && d <= 31)),
    { message: 'MONTHLY frequency requires frequencyDays in 1..31', path: ['frequencyDays'] }
  );

export type UpdateSupplyListInput = z.infer<typeof updateSupplyListSchema>;

/** POST /supply-lists/:listId/staff */
export const assignStaffSchema = z
  .object({
    staffId: bigIntIdString,
    isPrimary: z.boolean().optional().default(false),
  })
  .strict();

export type AssignStaffInput = z.infer<typeof assignStaffSchema>;

/** POST /supply-lists/:listId/customers */
export const addCustomersSchema = z
  .object({
    customerIds: z
      .array(bigIntIdString)
      .min(1, 'at least one customer')
      .max(100, 'too many customers'),
    useDefaultQuantity: z.boolean().optional().default(true),
    customQuantity: quantityField.optional(),
    useDefaultRate: z.boolean().optional().default(true),
    customRate: rateField.optional(),
    startDate: z.coerce.date().optional(),
  })
  .strict()
  .refine((d) => d.useDefaultQuantity !== false || d.customQuantity !== undefined, {
    message: 'customQuantity is required when useDefaultQuantity is false',
    path: ['customQuantity'],
  })
  .refine((d) => d.useDefaultRate !== false || d.customRate !== undefined, {
    message: 'customRate is required when useDefaultRate is false',
    path: ['customRate'],
  });

export type AddCustomersInput = z.infer<typeof addCustomersSchema>;

/** PATCH /supply-lists/:listId/customers/:subscriptionId */
export const updateSubscriptionSchema = z
  .object({
    quantity: quantityField.nullable().optional(),
    ratePerUnit: rateField.nullable().optional(),
    status: z.enum(['active', 'paused']).optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateSubscriptionInput = z.infer<typeof updateSubscriptionSchema>;
