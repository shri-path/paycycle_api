import { VendorUserStatus } from '@prisma/client';
import { PermissionKey } from '../../domain/value-objects/permission-key.value-object';

export interface UpdateStaffRequestDto {
  vendorId: bigint;
  staffId: bigint;
  performedByUserId: bigint;
  performedByRole: string;
  /** Display name — updates the linked User.name. */
  name?: string;
  /** ACTIVE | DISABLED — owner-settable statuses only. */
  status?: VendorUserStatus;
  /** undefined = unchanged; null = clear the label. */
  areaRouteLabel?: string | null;
  permissions?: PermissionKey[];
  ip: string | null;
  userAgent: string | null;
}
