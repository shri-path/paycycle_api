/**
 * Response DTOs for the Subscription & Pricing Management module.
 * Field whitelist only — no raw Prisma or entity objects.
 */

export interface PlanDto {
  id: string;
  planCode: string;
  planName: string;
  maxCustomers: number;
  maxStaff: number;
  maxSupplyLists: number;
  priceMonthly: number;
  priceYearly: number | null;
  features: Record<string, boolean> | null;
}

export interface CurrentPlanDto {
  subscriptionId: string;
  planId: string;
  planCode: string;
  planName: string;
  status: string;
  billingCycle: string;
  startDate: string;
  endDate: string | null;
  nextBillingDate: string | null;
  autoRenewal: boolean;
  isTrial: boolean;
  limits: {
    maxCustomers: number;
    maxStaff: number;
    maxSupplyLists: number;
  };
}

export interface UsageDto {
  customers: number;
  staff: number;
  supplyLists: number;
}

export interface SubscriptionViewDto {
  currentPlan: CurrentPlanDto;
  usage: UsageDto;
  utilizationPercentage: UsageDto;
  canAddMore: { customers: boolean; staff: boolean; supplyLists: boolean };
}

export interface SubscriptionSummaryDto {
  subscriptionId: string;
  planId: string;
  planCode: string;
  planName: string;
  status: string;
  billingCycle: string;
  startDate: string;
  endDate: string | null;
  nextBillingDate: string | null;
  autoRenewal: boolean;
}

export interface InvoiceSummaryDto {
  id: string;
  invoiceNumber: string;
  amount: number;
  tax: number;
  totalAmount: number;
  invoiceDate: string;
  dueDate: string;
  paymentStatus: string;
  paymentUrl: string;
}

export interface UpgradeResponseDto {
  subscription: SubscriptionSummaryDto;
  invoice: InvoiceSummaryDto;
}

export interface RenewResponseDto {
  subscription: SubscriptionSummaryDto;
  invoice: InvoiceSummaryDto;
}

export interface CancelResponseDto {
  subscriptionId: string;
  status: string;
  autoRenewal: boolean;
  activeUntil: string | null;
}

export interface AutoRenewalResponseDto {
  subscriptionId: string;
  autoRenewal: boolean;
}

export interface InvoiceDto {
  id: string;
  invoiceNumber: string;
  amount: number;
  tax: number;
  totalAmount: number;
  invoiceDate: string;
  dueDate: string;
  paymentStatus: string;
  paymentDate: string | null;
  paymentMethod: string | null;
  paymentReference: string | null;
}

export interface HistoryEventDto {
  id: string;
  eventType: string;
  oldPlanName: string | null;
  newPlanName: string | null;
  reason: string | null;
  performedByUserId: string | null;
  createdAt: string;
}

export interface ListPlansResult {
  plans: PlanDto[];
}

export interface PaginatedResult<T> {
  rows: T[];
  total: number;
}
