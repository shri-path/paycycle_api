/**
 * Write side of supply-list assignment (Supply Lists context — US-005, not yet
 * built). Kept separate from the read-only ListAssignmentPort so the stable US-002
 * read stub is untouched. Until US-005 ships, a fail-closed stub backs this port
 * and every method throws FeatureNotAvailableError (503).
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
