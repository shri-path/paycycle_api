/**
 * ReadModel DTOs and row types for the Dashboard module.
 * All reads are plain objects — no domain entities, no Prisma types.
 */

// ── Read model rows (from repository) ────────────────────────────────────────

export interface CustomerBalanceRow {
  customerId: bigint;
  customerName: string;
  balance: number;
  creditLimit: number;
  paymentScore: number;
  lastPaymentDate: Date | null;
  oldestUnpaidDate: Date | null;
}

export interface QuickStatsRow {
  supplyListsCount: number;
  totalCustomers: number;
  activeStaff: number;
  conflictsToday: number;
}

export interface ListProgressRow {
  listId: bigint;
  listName: string;
  startTime: string | null;
  staffName: string | null;
  total: number;
  completed: number;
}

export interface ForecastSubscriptionRow {
  subscriptionId: bigint;
  listId: bigint;
  listName: string;
  supplyType: string | null;
  unit: string;
  defaultQuantity: number;
  customQuantity: number | null;
  customerId: bigint;
  startDate: Date | null;
  endDate: Date | null;
  frequency: string;
}

export interface LeaveRow {
  supplyListCustomerId: bigint;
  startDate: Date;
  endDate: Date;
}

// ── Response DTOs ─────────────────────────────────────────────────────────────

export interface AgingBucket {
  amount: number;
  customerCount: number;
}

export interface OwnerDashboardDto {
  currentMonth: string;
  financial: {
    totalRevenue: number;
    collected: number;
    pending: number;
    collectionPercentage: number;
    outstandingAging: {
      fresh_0_30: AgingBucket;
      overdue_30_60: AgingBucket;
      critical_60_plus: AgingBucket;
    };
    advanceCredit: number;
    netReceivable: number;
  };
  quickStats: {
    supplyListsCount: number;
    totalCustomers: number;
    activeStaff: number;
    conflictsToday: number;
  };
  autoMarkStatus: 'on' | 'off';
  supplyForecast: {
    tomorrow: TomorrowForecastItem[];
    next7Days: {
      totalBySupplyType: Record<string, { quantity: number; unit: string }>;
    };
  };
  todaySupplyLists: TodaySupplyListItem[];
}

export interface TomorrowForecastItem {
  listName: string;
  quantity: number;
  unit: string;
  customerCount: number;
}

export interface TodaySupplyListItem {
  id: string;
  name: string;
  startTime: string | null;
  staffName: string | null;
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
  status: 'not_started' | 'in_progress' | 'completed';
}

export interface StaffDashboardDto {
  date: string;
  staffName: string | null;
  todayProgress: {
    totalDeliveries: number;
    completed: number;
    percentage: number;
  };
  assignedLists: AssignedListItem[];
  pendingCount: number;
}

export interface AssignedListItem {
  id: string;
  name: string;
  startTime: string | null;
  progress: {
    completed: number;
    total: number;
    percentage: number;
  };
  status: 'not_started' | 'in_progress' | 'completed';
}

export interface SupplyForecastDto {
  date: string;
  byList: ByListForecastItem[];
  aggregatedByType: Record<string, { totalQuantity: number; unit: string; lists: string[] }>;
  nextNDays: {
    days: number;
    byType: Record<string, { totalQuantity: number; unit: string; dailyAverage: number }>;
  };
}

export interface ByListForecastItem {
  listId: string;
  listName: string;
  supplyType: string | null;
  quantity: number;
  unit: string;
  customerCount: number;
  plannedLeaves: number;
}

export interface OutstandingAgingDto {
  summary: {
    totalOutstanding: number;
    fresh_0_30: AgingBucket;
    overdue_30_60: AgingBucket;
    critical_60_plus: AgingBucket;
  };
  priorityCustomers: {
    high: PriorityCustomerItem[];
    medium: PriorityCustomerItem[];
    low: PriorityCustomerItem[];
  };
  advanceCredit: {
    totalAmount: number;
    customerCount: number;
    customers: AdvanceCreditItem[];
  };
}

export interface PriorityCustomerItem {
  customerId: string;
  customerName: string;
  outstanding: number;
  daysOverdue: number;
  creditLimit: number;
  utilizationPercentage: number;
  lastPaymentDate: string | null;
  paymentScore: number;
}

export interface AdvanceCreditItem {
  customerId: string;
  customerName: string;
  creditBalance: number;
  monthsCovered: number;
}
