/**
 * Abstraction over a vendor's subscription staff cap (US-009, not yet built).
 * Stubbed as unlimited until US-009 (OQ-7).
 */
export interface SubscriptionLimitPort {
  /** Max active staff allowed for the vendor; null = unlimited. */
  getStaffLimit(vendorId: bigint): Promise<number | null>;
  /** Current count of non-removed staff memberships for the vendor. */
  getCurrentStaffCount(vendorId: bigint): Promise<number>;
}
