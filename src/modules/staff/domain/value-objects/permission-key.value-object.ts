import { ArgumentInvalidException } from '@/common/errors/app-error';

/**
 * Staff-grantable permission capabilities.
 * These are the ONLY per-staff grants the product exposes (story spec).
 * Owner role is all-allow and ignores grants.
 */
export enum PermissionKey {
  MARK_DELIVERIES = 'mark_deliveries',
  MARK_LEAVES = 'mark_leaves',
  ADD_EXTRA_CHARGES = 'add_extra_charges',
}

const ALL_KEYS: readonly string[] = Object.values(PermissionKey);

export const PermissionKeyVO = {
  /**
   * Parse a raw string into a PermissionKey, throwing on unknown values.
   */
  from(raw: string): PermissionKey {
    if (!ALL_KEYS.includes(raw)) {
      throw new ArgumentInvalidException(
        `Invalid permission key: "${raw}". Allowed: ${ALL_KEYS.join(', ')}`
      );
    }
    return raw as PermissionKey;
  },

  isValid(raw: string): raw is PermissionKey {
    return ALL_KEYS.includes(raw);
  },

  all(): PermissionKey[] {
    return Object.values(PermissionKey);
  },
};
