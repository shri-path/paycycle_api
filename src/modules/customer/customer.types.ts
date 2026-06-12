/**
 * Customer module DTOs (API response shapes).
 * All BigInt IDs are strings in responses.
 */

export interface SubscriptionDto {
  subscriptionId: string;
  listId: string;
  listName: string;
  startTime: string | null;
  quantity: number | null;
  unit: string;
  ratePerUnit: number | null;
  frequency: string;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  isCustomRate: boolean;
  isCustomQuantity: boolean;
}

export interface PaymentDto {
  id: string;
  amount: number;
  date: string;
  method: string;
  reference: string | null;
  createdAt: string;
}

export interface CustomerBillByListItem {
  listName: string;
  deliveries: number;
  leaves: number;
  quantity: number;
  unit: string;
  ratePerUnit: number;
  subtotal: number;
}

export interface CustomerBillExtraCharge {
  date: string;
  amount: number;
  reason: string;
  listName: string;
}

export interface CustomerBillDto {
  customerId: string;
  customerName: string;
  month: string;
  billDetails: {
    byList: CustomerBillByListItem[];
    extraCharges: CustomerBillExtraCharge[];
    subtotal: number;
    previousDue: number;
    totalDue: number;
  };
  paymentStatus: string;
}

export interface CustomerCalendarDelivery {
  listName: string;
  quantity: number;
  unit: string;
  status: string;
  amount: number;
}

export interface CustomerCalendarDto {
  month: string;
  days: Record<string, { deliveries: CustomerCalendarDelivery[] }>;
}

export interface CustomerListItemDto {
  id: string;
  name: string;
  phoneNumber: string;
  address: string | null;
  area: string | null;
  customerSince: string | null;
  status: string;
  supplyLists: string[];
  /** Owner-only — null for staff */
  monthlyTotal: number | null;
  /** Owner-only — null for staff */
  paymentStatus: string | null;
  /** Owner-only — null for staff */
  currentBalance: number | null;
  /** Owner-only — null for staff */
  paymentScore: number | null;
}

export interface CustomerDetailDto {
  id: string;
  name: string;
  phoneNumber: string;
  email: string | null;
  address: string | null;
  area: string | null;
  language: string;
  customerSince: string | null;
  status: string;
  creditLimit: number;
  currentBalance: number | null;
  paymentScore: number;
  creditUtilization: number | null;
  subscriptions: SubscriptionDto[];
  currentMonthBill: {
    month: string;
    subtotal: number;
    previousDue: number;
    totalDue: number;
    status: string;
  } | null;
  paymentHistory: PaymentDto[];
  createdAt: string;
  updatedAt: string;
}
