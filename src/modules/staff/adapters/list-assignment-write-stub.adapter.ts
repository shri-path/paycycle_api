import { Logger } from '@/infrastructure/logger/logger';
import { ListAssignmentWritePort } from '../ports/list-assignment-write.port';
import { FeatureNotAvailableError } from '../domain/staff.errors';

const UNAVAILABLE_MESSAGE = 'Supply list assignment is not available yet (US-005).';

/**
 * Fail-closed stub for the supply-list write port (OQ-9). Every method throws
 * FeatureNotAvailableError (503). The real adapter ships in US-005 and is swapped
 * in the composition root only. Callers reach this stub ONLY after the auth →
 * owner → tenant guards pass, so the 503 never leaks staff/list existence.
 */
export class ListAssignmentWriteStubAdapter implements ListAssignmentWritePort {
  constructor(private readonly logger: Logger) {}

  assign(
    staffMembershipId: bigint,
    listId: bigint,
    _isPrimary: boolean,
    _assignedByUserId: bigint
  ): Promise<void> {
    this.logUnavailable('assign', staffMembershipId, listId);
    return Promise.reject(new FeatureNotAvailableError(UNAVAILABLE_MESSAGE));
  }

  unassign(staffMembershipId: bigint, listId: bigint): Promise<void> {
    this.logUnavailable('unassign', staffMembershipId, listId);
    return Promise.reject(new FeatureNotAvailableError(UNAVAILABLE_MESSAGE));
  }

  setPrimary(staffMembershipId: bigint, listId: bigint): Promise<void> {
    this.logUnavailable('setPrimary', staffMembershipId, listId);
    return Promise.reject(new FeatureNotAvailableError(UNAVAILABLE_MESSAGE));
  }

  private logUnavailable(op: string, staffMembershipId: bigint, listId: bigint): void {
    this.logger.warn(
      { op, staffMembershipId: staffMembershipId.toString(), listId: listId.toString() },
      'ListAssignmentWriteStubAdapter: feature not available (US-005 not built)'
    );
  }
}
