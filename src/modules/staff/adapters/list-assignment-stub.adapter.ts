import { Logger } from '@/infrastructure/logger/logger';
import { ListAssignmentPort } from '../ports/list-assignment.port';

/**
 * Fail-closed stub for the Supply List assignment port (OQ-1).
 *
 * Until US-005 ships:
 *  - counts/ids report empty (no lists exist yet)
 *  - assignment checks return FALSE (staff are denied list-scoped actions —
 *    correct security posture; owners are always-allow and never hit this)
 *  - unassignAll is a no-op that logs for traceability
 *
 * The real adapter lands in US-005 and is swapped in the composition root only.
 */
export class ListAssignmentStubAdapter implements ListAssignmentPort {
  constructor(private readonly logger: Logger) {}

  countAssignedLists(_staffMembershipId: bigint): Promise<number> {
    return Promise.resolve(0);
  }

  getAssignedListIds(_staffMembershipId: bigint): Promise<bigint[]> {
    return Promise.resolve([]);
  }

  isAssignedToList(_staffMembershipId: bigint, _listId: bigint): Promise<boolean> {
    return Promise.resolve(false);
  }

  isCustomerInAssignedList(_staffMembershipId: bigint, _customerId: bigint): Promise<boolean> {
    return Promise.resolve(false);
  }

  unassignAll(staffMembershipId: bigint): Promise<void> {
    this.logger.info(
      { staffMembershipId: staffMembershipId.toString() },
      'ListAssignmentStubAdapter: unassignAll no-op (US-005 not built)'
    );
    return Promise.resolve();
  }
}
