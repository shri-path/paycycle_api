import { SupplyFrequency } from '@prisma/client';

/** Derived list status returned to clients. */
export type SupplyListStatus = 'active' | 'archived';

/** Subscription status returned to clients. */
export type SubscriptionStatusLabel = 'active' | 'paused' | 'ended';

/** An assigned staff member as seen on a supply list. */
export interface AssignedStaffDto {
  staffId: string;
  staffName: string | null;
  phoneNumber?: string | null;
  isPrimary: boolean;
}

/** Today's delivery roll-up (zeroed by the stub until US-006). */
export interface TodayStatsDto {
  date: string;
  delivered: number;
  onLeave: number;
  pending: number;
  totalQuantity: number;
}

/** This month's delivery roll-up (zeroed by the stub until US-006). */
export interface MonthStatsDto {
  month: string;
  daysCompleted: number;
  totalQuantity: number;
  revenue: number;
}

/** Row in the supply-list listing. */
export interface SupplyListListDto {
  id: string;
  name: string;
  supplyType: string | null;
  unit: string;
  defaultQuantity: number | null;
  defaultRatePerUnit: number | null;
  startTime: string | null;
  frequency: SupplyFrequency;
  status: SupplyListStatus;
  assignedStaff: AssignedStaffDto[];
  customerCount: number;
  todayStats: TodayStatsDto;
}

/** Full supply-list detail. */
export interface SupplyListDto extends SupplyListListDto {
  frequencyDays: number[];
  monthStats: MonthStatsDto;
}

/** A customer subscription as returned to clients. */
export interface SubscriptionDto {
  subscriptionId: string;
  customerId: string;
  customerName: string | null;
  phoneNumber?: string | null;
  address?: string | null;
  quantity: number;
  ratePerUnit: number;
  amount: number;
  isCustomQuantity: boolean;
  isCustomRate: boolean;
  startDate: string | null;
  status: SubscriptionStatusLabel;
  otherLists: string[];
  otherListsCount: number;
}

/** A vendor customer eligible to be added to a list. */
export interface AvailableCustomerDto {
  customerId: string;
  name: string | null;
  phone: string | null;
  otherLists: string[];
  otherListsCount: number;
}

/** Bulk add-customers result. */
export interface AddCustomersResultDto {
  addedCount: number;
  skippedCount: number;
  subscriptions: SubscriptionDto[];
  skipped: Array<{ customerId: string; reason: string }>;
}

/** DELETE list response. */
export interface ArchiveListResultDto {
  id: string;
  status: 'archived';
}

/** DELETE subscription response. */
export interface EndSubscriptionResultDto {
  subscriptionId: string;
  status: 'ended';
  endDate: string;
}
