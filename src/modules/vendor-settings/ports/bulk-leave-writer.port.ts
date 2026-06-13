/**
 * BulkLeaveWriterPort — cross-module write interface for bulk leave creation.
 * Commands depend on this port; infrastructure provides the Prisma adapter.
 */

export interface BulkLeaveWriterPort {
  /**
   * Resolve active subscription IDs for a vendor.
   * mode 'all' returns all; mode 'specific' returns only those in ids[].
   * Only returns subscriptions that belong to the vendor (tenant-safe).
   */
  resolveSubscriptions(
    vendorId: bigint,
    mode: 'all' | 'specific',
    ids?: bigint[]
  ): Promise<bigint[]>;

  /** Returns true if a Leave row already covers the subscription on the given date. */
  hasCoveringLeave(subscriptionId: bigint, date: string): Promise<boolean>;

  /**
   * Insert a Leave row for the given subscription + date.
   * date: "YYYY-MM-DD"
   */
  createLeave(
    subscriptionId: bigint,
    date: string,
    reason: string | null,
    source: 'VENDOR_MARKED',
    userId: bigint
  ): Promise<void>;

  /**
   * Update existing DailySupply rows for the subscription + date to status LEAVE.
   * Returns the count of rows updated.
   */
  markDeliveriesLeave(subscriptionId: bigint, date: string): Promise<number>;

  /** Return today's date as "YYYY-MM-DD" in Asia/Kolkata timezone. */
  today(): string;
}
