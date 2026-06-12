/**
 * DashboardMapper — ReadModel rows → Response DTOs (whitelisted).
 * All BigInt IDs → strings. All amounts → integers (INR whole rupees).
 * Staff DTO has ZERO financial fields by construction.
 */
import {
  ListProgressRow,
  OwnerDashboardDto,
  StaffDashboardDto,
  TodaySupplyListItem,
  AssignedListItem,
  SupplyForecastDto,
  OutstandingAgingDto,
} from './dashboard.types';
import { FinancialSummaryResult } from './services/financial-summary.calculator';
import { ForecastResult } from './services/supply-forecast.calculator';
import { AgingFullResult } from './services/outstanding-aging.calculator';
import { QuickStatsRow } from './dashboard.types';

function listProgressStatus(
  completed: number,
  total: number
): 'not_started' | 'in_progress' | 'completed' {
  if (total === 0 || completed === 0) return 'not_started';
  if (completed === total) return 'completed';
  return 'in_progress';
}

function toTodayListItem(row: ListProgressRow): TodaySupplyListItem {
  const percentage = row.total === 0 ? 0 : Math.round((row.completed / row.total) * 100);
  return {
    id: row.listId.toString(),
    name: row.listName,
    startTime: row.startTime,
    staffName: row.staffName,
    progress: { completed: row.completed, total: row.total, percentage },
    status: listProgressStatus(row.completed, row.total),
  };
}

function toAssignedListItem(row: ListProgressRow): AssignedListItem {
  const percentage = row.total === 0 ? 0 : Math.round((row.completed / row.total) * 100);
  return {
    id: row.listId.toString(),
    name: row.listName,
    startTime: row.startTime,
    progress: { completed: row.completed, total: row.total, percentage },
    status: listProgressStatus(row.completed, row.total),
  };
}

export class DashboardMapper {
  static toOwnerDashboardDto(params: {
    currentMonth: string;
    financial: FinancialSummaryResult;
    quickStats: QuickStatsRow;
    autoMarkEnabled: boolean;
    tomorrowForecast: ForecastResult;
    next7DaysForecast: ForecastResult;
    todayLists: ListProgressRow[];
  }): OwnerDashboardDto {
    const {
      currentMonth,
      financial,
      quickStats,
      autoMarkEnabled,
      tomorrowForecast,
      next7DaysForecast,
      todayLists,
    } = params;

    return {
      currentMonth,
      financial: {
        totalRevenue: financial.totalRevenue,
        collected: financial.collected,
        pending: financial.pending,
        collectionPercentage: financial.collectionPercentage,
        outstandingAging: {
          fresh_0_30: financial.outstandingAging.fresh_0_30,
          overdue_30_60: financial.outstandingAging.overdue_30_60,
          critical_60_plus: financial.outstandingAging.critical_60_plus,
        },
        advanceCredit: financial.advanceCredit,
        netReceivable: financial.netReceivable,
      },
      quickStats: {
        supplyListsCount: quickStats.supplyListsCount,
        totalCustomers: quickStats.totalCustomers,
        activeStaff: quickStats.activeStaff,
        conflictsToday: quickStats.conflictsToday,
      },
      autoMarkStatus: autoMarkEnabled ? 'on' : 'off',
      supplyForecast: {
        tomorrow: tomorrowForecast.byList.map((item) => ({
          listName: item.listName,
          quantity: item.quantity,
          unit: item.unit,
          customerCount: item.customerCount,
        })),
        next7Days: {
          totalBySupplyType: Object.fromEntries(
            Object.entries(next7DaysForecast.nextNDays.byType).map(([k, v]) => [
              k,
              { quantity: v.totalQuantity, unit: v.unit },
            ])
          ),
        },
      },
      todaySupplyLists: todayLists.map(toTodayListItem),
    };
  }

  static toStaffDashboardDto(params: {
    date: Date;
    staffName: string | null;
    assignedLists: ListProgressRow[];
  }): StaffDashboardDto {
    // Financial-free by construction — no money fields exist in this DTO
    const { date, staffName, assignedLists } = params;

    const totalDeliveries = assignedLists.reduce((sum, l) => sum + l.total, 0);
    const completed = assignedLists.reduce((sum, l) => sum + l.completed, 0);
    const percentage = totalDeliveries === 0 ? 0 : Math.round((completed / totalDeliveries) * 100);
    const pendingCount = totalDeliveries - completed;

    return {
      date: date.toISOString().slice(0, 10),
      staffName,
      todayProgress: { totalDeliveries, completed, percentage },
      assignedLists: assignedLists.map(toAssignedListItem),
      pendingCount: Math.max(pendingCount, 0),
    };
  }

  static toSupplyForecastDto(result: ForecastResult): SupplyForecastDto {
    return {
      date: result.date.toISOString().slice(0, 10),
      byList: result.byList,
      aggregatedByType: result.aggregatedByType,
      nextNDays: result.nextNDays,
    };
  }

  static toOutstandingAgingDto(
    result: AgingFullResult & { totalPriorityCount: number }
  ): OutstandingAgingDto {
    return {
      summary: {
        totalOutstanding: result.summary.totalOutstanding,
        fresh_0_30: result.summary.fresh_0_30,
        overdue_30_60: result.summary.overdue_30_60,
        critical_60_plus: result.summary.critical_60_plus,
      },
      priorityCustomers: result.priorityCustomers,
      advanceCredit: result.advanceCredit,
    };
  }
}
