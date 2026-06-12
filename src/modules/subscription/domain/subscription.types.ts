/**
 * Domain types for the Platform Subscription & Billing bounded context.
 * Framework-free: no Prisma, Express, or Pino imports.
 */

export enum VendorSubscriptionStatus {
  TRIAL = 'TRIAL',
  ACTIVE = 'ACTIVE',
  PAST_DUE = 'PAST_DUE',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum BillingCycleEnum {
  MONTHLY = 'MONTHLY',
  YEARLY = 'YEARLY',
}

export enum SubscriptionEventType {
  CREATED = 'CREATED',
  UPGRADED = 'UPGRADED',
  DOWNGRADED = 'DOWNGRADED',
  RENEWED = 'RENEWED',
  CANCELLED = 'CANCELLED',
  EXPIRED = 'EXPIRED',
}

export enum InvoicePaymentStatus {
  PAID = 'PAID',
  PENDING = 'PENDING',
  OVERDUE = 'OVERDUE',
}

export interface SubscriptionPlanProps {
  planName: string;
  planCode: string;
  priceMonthly: number;
  priceYearly: number | null;
  maxCustomers: number;
  maxStaff: number;
  maxSupplyLists: number;
  features: Record<string, boolean> | null;
  isActive: boolean;
}

export interface VendorSubscriptionProps {
  vendorId: bigint;
  subscriptionPlanId: bigint;
  billingCycle: BillingCycleEnum;
  startDate: Date;
  endDate: Date | null;
  nextBillingDate: Date | null;
  status: VendorSubscriptionStatus;
  amountPaid: number;
  autoRenewal: boolean;
  isTrial: boolean;
  trialEndsAt: Date | null;
}

export interface AppendHistoryInput {
  vendorSubscriptionId: bigint;
  eventType: SubscriptionEventType;
  oldPlanId?: bigint | null;
  newPlanId?: bigint | null;
  reason?: string | null;
  performedByUserId?: bigint | null;
}

export interface InvoiceInsertInput {
  vendorSubscriptionId: bigint;
  vendorId: bigint;
  invoiceNumber: string;
  amount: number;
  tax: number;
  totalAmount: number;
  invoiceDate: Date;
  dueDate: Date;
  paymentStatus: InvoicePaymentStatus;
  paymentDate?: Date | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
}
