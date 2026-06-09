import { PermissionKey } from '../../domain/value-objects/permission-key.value-object';

export interface PermissionGrantInput {
  key: PermissionKey;
  granted: boolean;
}

export interface UpdatePermissionsRequestDto {
  vendorId: bigint;
  staffId: bigint;
  performedByUserId: bigint;
  performedByRole: string;
  /** Grant-map: each entry explicitly sets one permission; others are unchanged. */
  permissions: PermissionGrantInput[];
  ip: string | null;
  userAgent: string | null;
}
