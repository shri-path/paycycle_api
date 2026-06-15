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
}
