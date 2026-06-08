import { SubscriptionLimitPort } from '../ports/subscription-limit.port';
import { IVendorMembershipRepository } from '../database/vendor-membership.repository.port';

/**
 * Unlimited-staff stub for the subscription limit port (OQ-7).
 *
 * `getStaffLimit` always returns null (unlimited) until US-009 supplies a real
 * adapter; the 451 plumbing and error class already exist and are unit-tested
 * with a mocked port. `getCurrentStaffCount` reports the live count so US-009
 * is a drop-in replacement.
 */
export class SubscriptionLimitStubAdapter implements SubscriptionLimitPort {
  constructor(private readonly membershipRepository: IVendorMembershipRepository) {}

  getStaffLimit(_vendorId: bigint): Promise<number | null> {
    return Promise.resolve(null);
  }

  getCurrentStaffCount(vendorId: bigint): Promise<number> {
    return this.membershipRepository.countActiveStaff(vendorId);
  }
}
