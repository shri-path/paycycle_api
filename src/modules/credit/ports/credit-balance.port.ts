/**
 * CreditBalancePort — ACL over existing delivery/payment balance capabilities.
 * Implementations use raw Prisma without importing customer/delivery module classes.
 */

export interface PaymentModeBreakdownRow {
  mode: string;
  amount: number;
  percentage: number;
}

export interface CollectionTrendRow {
  month: string;
  percentage: number;
}

export interface TopPayerRow {
  customerId: bigint;
  customerName: string;
  amount: number;
}

export interface ICreditBalancePort {
  getBulkBalances(customerIds: bigint[], vendorId: bigint): Promise<Map<string, number>>;
  getCustomerBalance(customerId: bigint, vendorId: bigint): Promise<number>;
  getOldestUnpaidServiceDate(
    customerIds: bigint[],
    vendorId: bigint
  ): Promise<Map<string, Date | null>>;
  getMonthlyBilled(vendorId: bigint, month: string): Promise<number>;
  getMonthlyCollected(vendorId: bigint, month: string): Promise<number>;
  getPaymentModeBreakdown(vendorId: bigint, month: string): Promise<PaymentModeBreakdownRow[]>;
  getCollectionTrend(vendorId: bigint, months: string[]): Promise<CollectionTrendRow[]>;
  getTopPayers(vendorId: bigint, month: string, limit: number): Promise<TopPayerRow[]>;
}
