/**
 * CreditCustomerPort — ACL over the Customer aggregate.
 * Reads customer data and delegates credit-limit writes back to the customer context.
 */

export interface CustomerCreditRow {
  id: bigint;
  name: string;
  phone: string;
  creditLimit: number;
  paymentScore: number;
  status: string;
  lastPaymentDate: Date | null;
}

export interface ICreditCustomerPort {
  listCustomersWithCredit(vendorId: bigint): Promise<CustomerCreditRow[]>;
  getCustomer(customerId: bigint, vendorId: bigint): Promise<CustomerCreditRow | null>;
  setCreditLimit(customerId: bigint, vendorId: bigint, amount: number): Promise<void>;
}
