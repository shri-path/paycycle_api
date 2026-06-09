import { PermissionKey } from '../../domain/value-objects/permission-key.value-object';
import { InviteChannel } from '../../staff.types';

export interface InviteStaffRequestDto {
  vendorId: bigint;
  invitedByUserId: bigint;
  invitedByRole: string;
  phone: string;
  name: string | null;
  areaRouteLabel: string | null;
  permissions: PermissionKey[];
  /** WhatsApp/SMS channel chosen by the owner; null = unspecified. */
  sendVia: InviteChannel | null;
  ip: string | null;
  userAgent: string | null;
}
