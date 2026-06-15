/**
 * SubscriptionCreditPort — write port for applying credit redemptions to subscriptions.
 */
export interface ISubscriptionCreditPort {
  /**
   * Apply credits toward the vendor's next subscription invoice.
   * Stub implementation: logs and returns success.
   */
  applyCreditToNextInvoice(vendorId: bigint, amount: number): Promise<void>;

  /**
   * Apply credits toward a plan upgrade.
   * Stub implementation: logs and returns success.
   */
  applyCreditToUpgrade(vendorId: bigint, amount: number): Promise<void>;
}
