/**
 * BulkRateWriterPort — cross-module write interface for bulk rate adjustments.
 */

export interface SubscriptionTarget {
  subscriptionId: bigint;
  supplyListId: bigint;
}

export interface BulkRateWriterPort {
  /**
   * Resolve subscription targets for a vendor.
   * mode 'all' returns all active subscriptions; mode 'specific' returns only those in ids[].
   * Only returns subscriptions that belong to the vendor (tenant-safe).
   */
  resolveSubscriptions(
    vendorId: bigint,
    mode: 'all' | 'specific',
    ids?: bigint[]
  ): Promise<SubscriptionTarget[]>;

  /**
   * Update the default ratePerUnit for a supply list.
   * Validates the list belongs to vendorId.
   */
  updateListDefaultRate(listId: bigint, newRate: string, vendorId: bigint): Promise<void>;

  /**
   * Update ratePerUnit on subscriptions that have customRatePerUnit = null
   * (i.e., they use the list default). Returns the count of subscriptions updated.
   */
  updateSubsWithoutCustomRate(subscriptionIds: bigint[], newRate: string): Promise<number>;

  /**
   * Count subscriptions in the given list that have a custom rate (will be skipped).
   */
  countSubsWithCustomRate(subscriptionIds: bigint[]): Promise<number>;

  /**
   * Get the phone numbers of customers for the given subscriptions.
   * Returns { subscriptionId, phone }.
   */
  getCustomerPhones(
    subscriptionIds: bigint[],
    vendorId: bigint
  ): Promise<{ subscriptionId: bigint; phone: string }[]>;
}
