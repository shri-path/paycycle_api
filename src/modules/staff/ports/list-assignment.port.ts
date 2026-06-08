/**
 * Abstraction over Supply List assignments (US-005, not yet built).
 *
 * All list-scoped permission checks for staff sit behind this port so the
 * staff module has zero compile-time coupling to the unbuilt Supply List module.
 * Until US-005 ships, a fail-closed stub backs this port (OQ-1).
 */
export interface ListAssignmentPort {
  countAssignedLists(staffMembershipId: bigint): Promise<number>;
  getAssignedListIds(staffMembershipId: bigint): Promise<bigint[]>;
  isAssignedToList(staffMembershipId: bigint, listId: bigint): Promise<boolean>;
  isCustomerInAssignedList(staffMembershipId: bigint, customerId: bigint): Promise<boolean>;
  /** Called on staff removal to release all list assignments. */
  unassignAll(staffMembershipId: bigint): Promise<void>;
}
