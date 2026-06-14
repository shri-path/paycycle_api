/**
 * CreditMapper — converts domain entities ↔ persistence ↔ whitelisted DTOs.
 * Read-model builders for aggregated responses (dashboard, priority, analytics, history).
 */
import { CustomerCreditSettingsEntity } from './domain/customer-credit-settings.entity';
import { ReminderConfigEntity } from './domain/reminder-config.entity';
import { AgingBucketEnum } from './domain/value-objects/aging-bucket.vo';
import { ReminderHistoryRow } from './database/payment-reminder.repository.port';
import { CustomerCreditRow } from './ports/credit-customer.port';
import {
  PaymentModeBreakdownRow,
  CollectionTrendRow,
  TopPayerRow,
} from './ports/credit-balance.port';

function toDate(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().substring(0, 10);
}

// ── Settings response ─────────────────────────────────────────────────────────

export interface SettingsResponseDto {
  customerId: string;
  creditType: string;
  creditLimit: number;
  warningThreshold: number;
  actionOnBreach: string;
  minimumBalanceWarning: number | null;
  currentBalance: number;
  creditUtilization: number;
  breached: boolean;
  deliveriesPaused: boolean;
  warning: string | null;
}

export class CreditMapper {
  static toSettingsResponse(
    entity: CustomerCreditSettingsEntity,
    creditLimit: number,
    balance: number,
    deliveriesPaused: boolean,
    warning: string | null
  ): SettingsResponseDto {
    const p = entity.getProps();
    const breachResult = entity.evaluateBreach(balance, creditLimit);

    return {
      customerId: p.customerId.toString(),
      creditType: p.creditType.toLowerCase(),
      creditLimit,
      warningThreshold: p.warningThresholdPercent,
      actionOnBreach: p.actionOnBreach.toLowerCase(),
      minimumBalanceWarning: p.minimumBalanceWarning,
      currentBalance: balance,
      creditUtilization: breachResult.utilizationPercent,
      breached: breachResult.breached,
      deliveriesPaused,
      warning,
    };
  }

  // ── Reminder config response ───────────────────────────────────────────────

  static toReminderConfigResponse(entity: ReminderConfigEntity) {
    const p = entity.getProps();
    return {
      autoRemindersEnabled: p.autoRemindersEnabled,
      schedule3Days: p.schedule3Days,
      schedule15Days: p.schedule15Days,
      schedule30Days: p.schedule30Days,
      reminderTemplate: p.reminderTemplate,
      excludedCustomerIds: p.excludedCustomerIds.map(String),
    };
  }

  static defaultReminderConfigResponse() {
    return {
      autoRemindersEnabled: false,
      schedule3Days: true,
      schedule15Days: true,
      schedule30Days: true,
      reminderTemplate: null,
      excludedCustomerIds: [] as string[],
    };
  }

  // ── Dashboard response ────────────────────────────────────────────────────

  static toDashboardResponse(params: {
    agingBuckets: Map<AgingBucketEnum, { amount: number; count: number }>;
    advanceCredit: { totalAmount: number; customerCount: number };
    netReceivable: number;
    totalOutstanding: number;
    thisMonthBilled: number;
    thisMonthCollected: number;
    collectionTarget: number;
    customersAtLimit: Array<{ customerId: bigint; name: string; utilizationPercentage: number }>;
  }) {
    const {
      agingBuckets,
      advanceCredit,
      netReceivable,
      totalOutstanding,
      thisMonthBilled,
      thisMonthCollected,
      collectionTarget,
      customersAtLimit,
    } = params;

    const fresh = agingBuckets.get(AgingBucketEnum.FRESH_0_30) ?? { amount: 0, count: 0 };
    const overdue = agingBuckets.get(AgingBucketEnum.OVERDUE_30_60) ?? { amount: 0, count: 0 };
    const critical = agingBuckets.get(AgingBucketEnum.CRITICAL_60_PLUS) ?? { amount: 0, count: 0 };

    const percentage =
      thisMonthBilled > 0 ? Math.round((thisMonthCollected / thisMonthBilled) * 100) : 0;
    const gap = Math.max(0, collectionTarget - thisMonthCollected);

    return {
      outstandingOverview: {
        totalOutstanding,
        fresh_0_30: { amount: fresh.amount, customerCount: fresh.count },
        overdue_30_60: { amount: overdue.amount, customerCount: overdue.count },
        critical_60_plus: { amount: critical.amount, customerCount: critical.count },
      },
      advanceCredit,
      netReceivable,
      thisMonthProgress: {
        totalBilled: thisMonthBilled,
        collected: thisMonthCollected,
        percentage,
        target: collectionTarget,
        gap,
      },
      customersAtLimit: customersAtLimit.map((c) => ({
        customerId: c.customerId.toString(),
        name: c.name,
        utilizationPercentage: c.utilizationPercentage,
      })),
    };
  }

  // ── Priority card ─────────────────────────────────────────────────────────

  static toPriorityCard(params: {
    customer: CustomerCreditRow;
    balance: number;
    daysOverdue: number;
    utilizationPercent: number;
  }) {
    return {
      customerId: params.customer.id.toString(),
      customerName: params.customer.name,
      phoneNumber: params.customer.phone,
      outstanding: params.balance,
      daysOverdue: params.daysOverdue,
      creditLimit: params.customer.creditLimit,
      utilizationPercentage: params.utilizationPercent,
      lastPaymentDate: toDate(params.customer.lastPaymentDate),
      paymentScore: params.customer.paymentScore,
      creditType: 'normal',
    };
  }

  // ── Aging response ────────────────────────────────────────────────────────

  static toAgingResponse(params: {
    totalOutstanding: number;
    agingBuckets: Map<AgingBucketEnum, { amount: number; count: number }>;
  }) {
    const fresh = params.agingBuckets.get(AgingBucketEnum.FRESH_0_30) ?? { amount: 0, count: 0 };
    const overdue = params.agingBuckets.get(AgingBucketEnum.OVERDUE_30_60) ?? {
      amount: 0,
      count: 0,
    };
    const critical = params.agingBuckets.get(AgingBucketEnum.CRITICAL_60_PLUS) ?? {
      amount: 0,
      count: 0,
    };
    return {
      totalOutstanding: params.totalOutstanding,
      fresh_0_30: { amount: fresh.amount, customerCount: fresh.count },
      overdue_30_60: { amount: overdue.amount, customerCount: overdue.count },
      critical_60_plus: { amount: critical.amount, customerCount: critical.count },
    };
  }

  // ── Analytics response ────────────────────────────────────────────────────

  static toAnalyticsResponse(params: {
    month: string;
    totalBilled: number;
    collected: number;
    outstanding: number;
    target: number;
    modeBreakdown: PaymentModeBreakdownRow[];
    trend: CollectionTrendRow[];
    topPayers: TopPayerRow[];
    defaulters: Array<{
      customerId: bigint;
      customerName: string;
      amount: number;
      daysOverdue: number;
    }>;
  }) {
    const paymentModeBreakdown: Record<string, { amount: number; percentage: number }> = {};
    for (const row of params.modeBreakdown) {
      paymentModeBreakdown[row.mode] = { amount: row.amount, percentage: row.percentage };
    }

    return {
      month: params.month,
      monthlySummary: {
        totalBilled: params.totalBilled,
        collected: params.collected,
        outstanding: params.outstanding,
        collectionPercentage:
          params.totalBilled > 0 ? Math.round((params.collected / params.totalBilled) * 100) : 0,
        target: params.target,
      },
      paymentModeBreakdown,
      collectionTrend: params.trend,
      topPayers: params.topPayers.map((p) => ({
        customerId: p.customerId.toString(),
        customerName: p.customerName,
        amount: p.amount,
      })),
      defaulters: params.defaulters.map((d) => ({
        customerId: d.customerId.toString(),
        customerName: d.customerName,
        amount: d.amount,
        daysOverdue: d.daysOverdue,
      })),
    };
  }

  // ── Reminder history row ──────────────────────────────────────────────────

  static toReminderHistoryItem(row: ReminderHistoryRow) {
    return {
      id: row.id.toString(),
      amountDue: row.amountDue,
      reminderDate: toDate(row.reminderDate)!,
      sentVia: row.sentVia.toLowerCase(),
      status: row.status.toLowerCase(),
      responseType: row.responseType ? row.responseType.toLowerCase() : null,
      responseAmount: row.responseAmount,
    };
  }
}
