/**
 * Write side of supply-list assignment (Supply Lists context — US-005). Kept
 * separate from the read-only ListAssignmentPort so the two concerns evolve
 * independently. Backed by the real SupplyListAssignmentWriteAdapter (US-005).
 */
export interface ListAssignmentWritePort {
  assign(
    staffMembershipId: bigint,
    listId: bigint,
    isPrimary: boolean,
    assignedByUserId: bigint
  ): Promise<void>;
  unassign(staffMembershipId: bigint, listId: bigint): Promise<void>;
  setPrimary(staffMembershipId: bigint, listId: bigint): Promise<void>;
}
