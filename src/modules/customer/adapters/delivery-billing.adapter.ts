/**
 * DeliveryBillingAdapter — reads delivery data for customer billing calculations.
 * Uses raw Prisma queries on daily_supplies, supply_extra_charges, and payments tables.
 * Does NOT import any delivery module code.
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { Prisma, DailySupplyStatus } from '@prisma/client';
import {
  IDeliveryBillingPort,
  MonthlyDeliveryRow,
  ExtraChargeRow,
  DailySupplyCalendarRow,
} from '../ports/delivery-billing.port';

function toNum(d: Prisma.Decimal | null | undefined): number {
  return d == null ? 0 : Number(d.toString());
}

function monthRange(month: string): { start: Date; end: Date } {
  const parts = month.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1); // exclusive upper bound
  return { start, end };
}

// Statuses that count toward the balance
const BILLABLE_STATUSES: DailySupplyStatus[] = [
  DailySupplyStatus.DELIVERED,
  DailySupplyStatus.AUTO_MARKED,
];

export class DeliveryBillingAdapter implements IDeliveryBillingPort {
  async getCustomerBalance(customerId: bigint, vendorId: bigint): Promise<number> {
    const [deliverySum, paymentSum] = await Promise.all([
      // Sum of finalAmount on billable daily supplies (includes extra charges already)
      prisma.dailySupply.aggregate({
        where: {
          vendorId,
          subscription: { customerId },
          status: { in: BILLABLE_STATUSES },
        },
        _sum: { finalAmount: true },
      }),
      // Sum of all payments
      prisma.payment.aggregate({
        where: { customerId, vendorId },
        _sum: { amount: true },
      }),
    ]);

    const delivered = toNum(deliverySum._sum?.finalAmount);
    const paid = toNum(paymentSum._sum?.amount);
    return delivered - paid;
  }

  async getBulkBalances(customerIds: bigint[], vendorId: bigint): Promise<Map<string, number>> {
    if (customerIds.length === 0) return new Map();

    const [deliveries, payments] = await Promise.all([
      prisma.$queryRaw<Array<{ customer_id: bigint; total: string }>>`
        SELECT slc.customer_id, SUM(ds.final_amount)::text AS total
        FROM daily_supplies ds
        JOIN supply_list_customers slc ON slc.id = ds.supply_list_customer_id
        WHERE ds.vendor_id = ${vendorId}
          AND slc.customer_id = ANY(${customerIds})
          AND ds.status IN ('DELIVERED','AUTO_MARKED')
        GROUP BY slc.customer_id
      `,
      prisma.$queryRaw<Array<{ customer_id: bigint; total: string }>>`
        SELECT customer_id, SUM(amount)::text AS total
        FROM payments
        WHERE vendor_id = ${vendorId}
          AND customer_id = ANY(${customerIds})
        GROUP BY customer_id
      `,
    ]);

    const deliveryMap = new Map<string, number>();
    for (const row of deliveries) {
      deliveryMap.set(row.customer_id.toString(), Number(row.total) || 0);
    }

    const result = new Map<string, number>();
    for (const cid of customerIds) {
      const key = cid.toString();
      const delivered = deliveryMap.get(key) ?? 0;
      const paid = Number(payments.find((p) => p.customer_id.toString() === key)?.total) || 0;
      result.set(key, delivered - paid);
    }
    return result;
  }

  async getMonthlyDeliveries(
    customerId: bigint,
    vendorId: bigint,
    month: string
  ): Promise<MonthlyDeliveryRow[]> {
    const { start, end } = monthRange(month);

    const rows = await prisma.$queryRaw<
      Array<{
        supply_list_id: bigint;
        supply_list_name: string;
        deliveries: bigint;
        leaves: bigint;
        total_quantity: string;
        unit: string;
        rate_per_unit: string;
        subtotal: string;
      }>
    >`
      SELECT
        ds.supply_list_id,
        sl.name AS supply_list_name,
        COUNT(*) FILTER (WHERE ds.status IN ('DELIVERED','AUTO_MARKED')) AS deliveries,
        COUNT(*) FILTER (WHERE ds.status = 'LEAVE') AS leaves,
        SUM(ds.quantity) FILTER (WHERE ds.status IN ('DELIVERED','AUTO_MARKED'))::text AS total_quantity,
        ds.unit,
        AVG(ds.rate_per_unit)::text AS rate_per_unit,
        SUM(ds.final_amount) FILTER (WHERE ds.status IN ('DELIVERED','AUTO_MARKED'))::text AS subtotal
      FROM daily_supplies ds
      JOIN supply_list_customers slc ON slc.id = ds.supply_list_customer_id
      JOIN supply_lists sl ON sl.id = ds.supply_list_id
      WHERE ds.vendor_id = ${vendorId}
        AND slc.customer_id = ${customerId}
        AND ds.service_date >= ${start}
        AND ds.service_date < ${end}
      GROUP BY ds.supply_list_id, sl.name, ds.unit
    `;

    return rows.map((r) => ({
      supplyListId: r.supply_list_id,
      supplyListName: r.supply_list_name,
      deliveries: Number(r.deliveries),
      leaves: Number(r.leaves),
      totalQuantity: Number(r.total_quantity) || 0,
      unit: r.unit,
      ratePerUnit: Number(r.rate_per_unit) || 0,
      subtotal: Number(r.subtotal) || 0,
    }));
  }

  async getMonthlyExtraCharges(
    customerId: bigint,
    vendorId: bigint,
    month: string
  ): Promise<ExtraChargeRow[]> {
    const { start, end } = monthRange(month);

    const rows = await prisma.$queryRaw<
      Array<{
        service_date: Date;
        amount: string;
        comment: string;
        supply_list_name: string;
      }>
    >`
      SELECT
        ds.service_date,
        sec.amount::text,
        sec.comment,
        sl.name AS supply_list_name
      FROM supply_extra_charges sec
      JOIN daily_supplies ds ON ds.id = sec.daily_supply_id
      JOIN supply_list_customers slc ON slc.id = ds.supply_list_customer_id
      JOIN supply_lists sl ON sl.id = ds.supply_list_id
      WHERE ds.vendor_id = ${vendorId}
        AND slc.customer_id = ${customerId}
        AND ds.service_date >= ${start}
        AND ds.service_date < ${end}
      ORDER BY ds.service_date ASC
    `;

    return rows.map((r) => ({
      date: r.service_date,
      amount: Number(r.amount) || 0,
      reason: r.comment,
      supplyListName: r.supply_list_name,
    }));
  }

  async getBalanceAsOf(customerId: bigint, vendorId: bigint, beforeMonth: string): Promise<number> {
    const { start } = monthRange(beforeMonth);

    const [deliverySum, paymentSum] = await Promise.all([
      prisma.dailySupply.aggregate({
        where: {
          vendorId,
          subscription: { customerId },
          status: { in: BILLABLE_STATUSES },
          serviceDate: { lt: start },
        },
        _sum: { finalAmount: true },
      }),
      prisma.payment.aggregate({
        where: {
          customerId,
          vendorId,
          paymentDate: { lt: start },
        },
        _sum: { amount: true },
      }),
    ]);

    return toNum(deliverySum._sum?.finalAmount) - toNum(paymentSum._sum?.amount);
  }

  async getDailySuppliesForCalendar(
    customerId: bigint,
    vendorId: bigint,
    from: Date,
    to: Date
  ): Promise<DailySupplyCalendarRow[]> {
    const rows = await prisma.dailySupply.findMany({
      where: {
        vendorId,
        subscription: { customerId },
        serviceDate: { gte: from, lte: to },
      },
      select: {
        serviceDate: true,
        quantity: true,
        unit: true,
        status: true,
        finalAmount: true,
        supplyList: { select: { name: true } },
      },
      orderBy: { serviceDate: 'asc' },
    });

    return rows.map((r) => ({
      serviceDate: r.serviceDate,
      supplyListName: r.supplyList.name,
      quantity: Number(r.quantity.toString()),
      unit: r.unit,
      status: r.status,
      finalAmount: Number(r.finalAmount.toString()),
    }));
  }

  async getCurrentMonthTotal(customerId: bigint, vendorId: bigint): Promise<number> {
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const { start, end } = monthRange(month);

    const agg = await prisma.dailySupply.aggregate({
      where: {
        vendorId,
        subscription: { customerId },
        status: { in: BILLABLE_STATUSES },
        serviceDate: { gte: start, lt: end },
      },
      _sum: { finalAmount: true },
    });
    return toNum(agg._sum?.finalAmount);
  }
}
