/**
 * SubscriptionInvoicePort — ACL read port for revenue share calculation.
 */
export interface PaidInvoiceResult {
  invoiceId: bigint;
  amount: number; // pre-tax amount (used for 10% revenue share)
  paymentDate: Date;
}

export interface ISubscriptionInvoicePort {
  /**
   * Find the PAID subscription invoice for a vendor in a given month (YYYY-MM).
   * Returns the first found paid invoice; null if none.
   */
  paidInvoiceForMonth(vendorId: bigint, yearMonth: string): Promise<PaidInvoiceResult | null>;

  /**
   * Check if a vendor's subscription is CANCELLED or EXPIRED (churn detection).
   */
  isSubscriptionChurned(vendorId: bigint): Promise<boolean>;
}
