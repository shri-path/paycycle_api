/**
 * CustomerCountPort — ACL read port.
 * Returns active customer count for a vendor without coupling to the customer module internals.
 */
export interface ICustomerCountPort {
  /**
   * Count ACTIVE vendor_customers for vendorId (deletedAt IS NULL, status = ACTIVE).
   */
  activeCustomerCount(vendorId: bigint): Promise<number>;

  /**
   * Count customers added within the last N days for qualification check.
   */
  customersAddedWithinDays(vendorId: bigint, days: number): Promise<number>;

  /**
   * Batched active-customer counts for many vendors in a SINGLE query.
   * Returns a Map keyed by vendorId; vendors with no active customers are
   * present with a value of 0. Used by the dashboard to avoid an N+1 of
   * per-referral activeCustomerCount calls.
   */
  activeCustomerCountByVendor(vendorIds: bigint[]): Promise<Map<bigint, number>>;
}
