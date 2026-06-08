import { z } from 'zod';
import { VendorUserStatus } from '@prisma/client';
import { PermissionKey } from './domain/value-objects/permission-key.value-object';

// ============================================================
// Reusable field schemas
// ============================================================

const phoneField = z
  .string()
  .trim()
  .regex(/^\+?[1-9][0-9]{7,14}$/, 'Invalid phone number format');

const bigIntIdString = z.string().regex(/^\d+$/, 'Invalid ID format');

const areaRouteLabelField = z
  .string()
  .trim()
  .max(200, 'areaRouteLabel must be at most 200 characters');

const strongPasswordField = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100, 'Password must be at most 100 characters');

const permissionKeyField = z.nativeEnum(PermissionKey, {
  errorMap: () => ({
    message: `permissionKey must be one of: ${Object.values(PermissionKey).join(', ')}`,
  }),
});

const permissionsArrayField = z
  .array(permissionKeyField)
  .max(10, 'Too many permissions')
  .describe('Granted staff permission keys');

// Staff status the owner may set directly (active/disabled only).
const settableStatusField = z.nativeEnum(VendorUserStatus, {
  errorMap: () => ({ message: 'status must be one of: ACTIVE, DISABLED' }),
});

const nameField = z.string().trim().min(1, 'Name is required').max(100, 'Name too long');

// ============================================================
// Path parameter schemas
// ============================================================

export const vendorIdParamSchema = z
  .object({
    vendorId: bigIntIdString,
  })
  .passthrough();

export type VendorIdParam = z.infer<typeof vendorIdParamSchema>;

export const staffIdParamSchema = z
  .object({
    vendorId: bigIntIdString,
    staffId: bigIntIdString,
  })
  .passthrough();

export type StaffIdParam = z.infer<typeof staffIdParamSchema>;

// ============================================================
// Mutation schemas (.strict — declare EVERY field the controller reads)
// ============================================================

/** POST /vendors/:vendorId/staff/invite */
export const inviteStaffSchema = z
  .object({
    phone: phoneField,
    name: nameField.optional(),
    areaRouteLabel: areaRouteLabelField.optional(),
    permissions: permissionsArrayField.optional().default([]),
    sendVia: z.enum(['whatsapp', 'sms']).optional(),
  })
  .strict();

export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

/** PATCH /vendors/:vendorId/staff/:staffId — partial update */
export const updateStaffSchema = z
  .object({
    status: settableStatusField.optional(),
    areaRouteLabel: areaRouteLabelField.nullable().optional(),
    permissions: permissionsArrayField.optional(),
  })
  .strict()
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;

/** POST /auth/accept-invite (public) */
export const acceptInviteSchema = z
  .object({
    token: z.string().trim().min(1, 'Token is required').max(255, 'Token too long'),
    password: strongPasswordField,
    name: nameField.optional(),
  })
  .strict();

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

// ============================================================
// Query schema (.passthrough for the dynamic query-builder)
// ============================================================

export const listStaffQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .passthrough();

export type ListStaffQuery = z.infer<typeof listStaffQuerySchema>;
