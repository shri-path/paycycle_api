/**
 * ReminderTargetPort — cross-module read interface for resolving reminder targets.
 */

export interface ReminderTarget {
  customerId: bigint;
  phone: string;
}

export interface ReminderTargetPort {
  /**
   * Resolve customers to send reminders to.
   * If customerIds is provided, filter to those IDs (tenant-safe).
   * If all = true, return all customers of the vendor with an outstanding balance.
   */
  resolveCustomers(
    vendorId: bigint,
    customerIds?: bigint[],
    all?: boolean
  ): Promise<ReminderTarget[]>;
}
