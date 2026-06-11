/**
 * ACL port (owned by Supply Lists) to validate a staff membership belongs to a
 * vendor and is ACTIVE before assigning it to a list. Reads the staff bounded
 * context's data without importing its domain code.
 */
export interface StaffMembershipInfo {
  /** vendor_users.id */
  id: bigint;
  status: string;
  displayName: string | null;
  phone: string | null;
}

export interface StaffDirectoryPort {
  /** Returns the membership if it exists in the vendor and is ACTIVE, else null. */
  findActiveMembership(vendorId: bigint, vendorUserId: bigint): Promise<StaffMembershipInfo | null>;
}
