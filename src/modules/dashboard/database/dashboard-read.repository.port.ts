/**
 * IDashboardReadRepository — read-only port for the dashboard module.
 * Returns plain ReadModel rows. No Prisma types leaked.
 */
import {
  CustomerBalanceRow,
  QuickStatsRow,
  ListProgressRow,
  ForecastSubscriptionRow,
  LeaveRow,
} from '../dashboard.types';

export interface IDashboardReadRepository {
  monthlyRevenue(vendorId: bigint, monthStart: Date, monthEnd: Date): Promise<number>;
  monthlyCollected(vendorId: bigint, monthStart: Date, monthEnd: Date): Promise<number>;
  customerBalances(vendorId: bigint): Promise<CustomerBalanceRow[]>;
  quickStats(vendorId: bigint, today: Date): Promise<QuickStatsRow>;
  todayListProgress(
    vendorId: bigint,
    today: Date,
    staffVendorUserId?: bigint
  ): Promise<ListProgressRow[]>;
  activeSubscriptionsForForecast(
    vendorId: bigint,
    supplyType?: string
  ): Promise<ForecastSubscriptionRow[]>;
  leavesInRange(vendorId: bigint, from: Date, to: Date): Promise<LeaveRow[]>;
  staffName(vendorId: bigint, staffVendorUserId: bigint): Promise<string | null>;
  staffExistsInVendor(vendorId: bigint, staffVendorUserId: bigint): Promise<boolean>;
}
