/**
 * Port for reading delivery and billing data from the delivery module.
 * The customer module NEVER imports delivery module internals directly.
 */

export interface MonthlyDeliveryRow {
  supplyListId: bigint;
  supplyListName: string;
  deliveries: number;
  leaves: number;
  totalQuantity: number;
  unit: string;
  ratePerUnit: number;
  subtotal: number;
}

export interface ExtraChargeRow {
  date: Date;
  amount: number;
  reason: string;
  supplyListName: string;
}

export interface DailySupplyCalendarRow {
  serviceDate: Date;
  supplyListName: string;
  quantity: number;
  unit: string;
  status: string;
  finalAmount: number;
}

export interface IDeliveryBillingPort {
  /**
   * Get the running balance for a customer.
   * Balance = Σ(finalAmount for DELIVERED/AUTO_MARKED DailySupply) + Σ(extraCharges) - Σ(payments)
   */
  getCustomerBalance(customerId: bigint, vendorId: bigint): Promise<number>;

  /**
   * Get balances for multiple customers in a single round-trip.
   * Returns a Map<customerId, balance>.
   */
  getBulkBalances(customerIds: bigint[], vendorId: bigint): Promise<Map<string, number>>;

  /**
   * Get monthly delivery aggregation by supply list.
   * @param month YYYY-MM format
   */
  getMonthlyDeliveries(
    customerId: bigint,
    vendorId: bigint,
    month: string
  ): Promise<MonthlyDeliveryRow[]>;

  /**
   * Get extra charges for a customer in a month.
   * @param month YYYY-MM format
   */
  getMonthlyExtraCharges(
    customerId: bigint,
    vendorId: bigint,
    month: string
  ): Promise<ExtraChargeRow[]>;

  /**
   * Get the balance as of the start of a given month (for previousDue calculation).
   * @param month YYYY-MM format
   */
  getBalanceAsOf(customerId: bigint, vendorId: bigint, beforeMonth: string): Promise<number>;

  /**
   * Get all daily supply rows for a customer within a date range (for calendar).
   */
  getDailySuppliesForCalendar(
    customerId: bigint,
    vendorId: bigint,
    from: Date,
    to: Date
  ): Promise<DailySupplyCalendarRow[]>;

  /**
   * Get current month's total delivered amount (for list endpoint summary).
   */
  getCurrentMonthTotal(customerId: bigint, vendorId: bigint): Promise<number>;
}
