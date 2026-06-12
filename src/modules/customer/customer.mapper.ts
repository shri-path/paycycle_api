import {
  CustomerRow,
  CustomerDetailRow,
  SubscriptionRow,
  PaymentRow,
} from './database/customer.repository.port';
import {
  CustomerListItemDto,
  CustomerDetailDto,
  SubscriptionDto,
  PaymentDto,
} from './customer.types';

function derivePaymentStatus(balance: number, creditLimit: number): string {
  if (balance <= 0) return 'paid';
  if (balance <= creditLimit) return 'pending';
  return 'overdue';
}

function deriveCreditUtilization(balance: number, creditLimit: number): number {
  if (creditLimit <= 0) return 0;
  return Math.round((balance / creditLimit) * 100);
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export const CustomerMapper = {
  toListItemDto(
    row: CustomerRow,
    balance: number | null,
    monthlyTotal: number | null
  ): CustomerListItemDto {
    const isOwner = balance !== null;
    const paymentStatus = isOwner ? derivePaymentStatus(balance, row.creditLimit) : null;

    return {
      id: row.id.toString(),
      name: row.name ?? '',
      phoneNumber: `${row.phoneCountryCode}${row.phone.replace(row.phoneCountryCode, '')}`,
      address: row.address,
      area: row.area,
      customerSince: row.customerSince ? row.customerSince.toISOString().slice(0, 10) : null,
      status: row.status,
      supplyLists: row.supplyListNames,
      monthlyTotal: isOwner ? (monthlyTotal ?? 0) : null,
      paymentStatus,
      currentBalance: balance,
      paymentScore: isOwner ? row.paymentScore : null,
    };
  },

  toDetailDto(
    row: CustomerDetailRow | CustomerRow,
    subscriptions: SubscriptionRow[],
    payments: PaymentRow[],
    balance: number | null,
    monthlyTotal: number | null
  ): CustomerDetailDto {
    const isOwner = balance !== null;
    const creditUtilization = isOwner ? deriveCreditUtilization(balance, row.creditLimit) : null;
    const paymentStatus = isOwner ? derivePaymentStatus(balance, row.creditLimit) : 'unknown';

    const month = currentMonth();
    const currentMonthBill =
      isOwner && monthlyTotal !== null
        ? {
            month,
            subtotal: monthlyTotal,
            previousDue: 0, // simplified for detail view — full breakdown via GET /bill/:month
            totalDue: balance,
            status: paymentStatus,
          }
        : null;

    return {
      id: row.id.toString(),
      name: row.name ?? '',
      phoneNumber: row.phone,
      email: row.email,
      address: row.address,
      area: row.area,
      language: row.languagePreference,
      customerSince: row.customerSince ? row.customerSince.toISOString().slice(0, 10) : null,
      status: row.status,
      creditLimit: row.creditLimit,
      currentBalance: balance,
      paymentScore: row.paymentScore,
      creditUtilization,
      subscriptions: subscriptions.map((s) => CustomerMapper.toSubscriptionDto(s)),
      currentMonthBill,
      paymentHistory: payments.map((p) => CustomerMapper.toPaymentDto(p)),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  },

  toSubscriptionDto(sub: SubscriptionRow): SubscriptionDto {
    const qty = sub.customQuantity ?? sub.defaultQuantity;
    const rate = sub.customRatePerUnit ?? sub.defaultRatePerUnit;
    return {
      subscriptionId: sub.id.toString(),
      listId: sub.supplyListId.toString(),
      listName: sub.supplyListName,
      startTime: sub.startTime,
      quantity: qty,
      unit: sub.unit,
      ratePerUnit: rate,
      frequency: sub.frequency,
      startDate: sub.startDate ? sub.startDate.toISOString().slice(0, 10) : null,
      endDate: sub.endDate ? sub.endDate.toISOString().slice(0, 10) : null,
      isActive: sub.isActive,
      isCustomRate: sub.customRatePerUnit !== null,
      isCustomQuantity: sub.customQuantity !== null,
    };
  },

  toPaymentDto(p: PaymentRow): PaymentDto {
    return {
      id: p.id.toString(),
      amount: p.amount,
      date:
        p.paymentDate instanceof Date
          ? p.paymentDate.toISOString().slice(0, 10)
          : String(p.paymentDate),
      method: p.paymentMethod.toLowerCase(),
      reference: p.referenceNumber,
      createdAt: p.createdAt.toISOString(),
    };
  },
};
