import { PermissionKey } from '../../domain/value-objects/permission-key.value-object';

export interface InviteStaffRequestDto {
  vendorId: bigint;
  invitedByUserId: bigint;
  invitedByRole: string;
  phone: string;
  name: string | null;
  areaRouteLabel: string | null;
  permissions: PermissionKey[];
  ip: string | null;
  userAgent: string | null;
}
