/**
 * CreditBalanceAdapter — raw Prisma queries over delivery/payment data.
 * Does NOT import customer or delivery module classes.
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { Prisma } from '@prisma/client';
import {
  ICreditBalancePort,
  PaymentModeBreakdownRow,
  CollectionTrendRow,
  TopPayerRow,
} from '../ports/credit-balance.port';

function toNum(d: Prisma.Decimal | string | null | undefined): number {
  if (d == null) return 0;
  return Number(d.toString()) || 0;
}

function monthRange(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
}

export class CreditBalanceAdapter implements ICreditBalancePort {
  async getBulkBalances(customerIds: bigint[], vendorId: bigint): Promise<Map<string, number>> {
    if (customerIds.length === 0) return new Map();

    const [deliveries, payments] = await Promise.all([
      prisma.$queryRaw<Array<{ customer_id: bigint; total: string }>>`
        SELECT slc.customer_id, COALESCE(SUM(ds.final_amount), 0)::text AS total
        FROM daily_supplies ds
        JOIN supply_list_customers slc ON slc.id = ds.supply_list_customer_id
        WHERE ds.vendor_id = ${vendorId}
          AND slc.customer_id = ANY(${customerIds})
          AND ds.status IN ('DELIVERED','AUTO_MARKED')
        GROUP BY slc.customer_id
      `,
      prisma.$queryRaw<Array<{ customer_id: bigint; total: string }>>`
        SELECT customer_id, COALESCE(SUM(amount), 0)::text AS total
        FROM payments
        WHERE vendor_id = ${vendorId}
          AND customer_id = ANY(${customerIds})
        GROUP BY customer_id
      `,
    ]);

    const deliveryMap = new Map<string, number>();
    for (const row of deliveries) {
      deliveryMap.set(row.customer_id.toString(), toNum(row.total));
    }

    const paymentMap = new Map<string, number>();
    for (const row of payments) {
      paymentMap.set(row.customer_id.toString(), toNum(row.total));
    }

    const result = new Map<string, number>();
    for (const cid of customerIds) {
      const key = cid.toString();
      result.set(key, (deliveryMap.get(key) ?? 0) - (paymentMap.get(key) ?? 0));
    }
    return result;
  }

  async getCustomerBalance(customerId: bigint, vendorId: bigint): Promise<number> {
    const [deliveryAgg, paymentAgg] = await Promise.all([
      prisma.dailySupply.aggregate({
        where: {
          vendorId,
          subscription: { customerId },
          status: { in: ['DELIVERED', 'AUTO_MARKED'] },
        },
        _sum: { finalAmount: true },
      }),
      prisma.payment.aggregate({
        where: { customerId, vendorId },
        _sum: { amount: true },
      }),
    ]);
    return toNum(deliveryAgg._sum?.finalAmount) - toNum(paymentAgg._sum?.amount);
  }

  async getOldestUnpaidServiceDate(
    customerIds: bigint[],
    vendorId: bigint
  ): Promise<Map<string, Date | null>> {
    if (customerIds.length === 0) return new Map();

    // FIFO approximation: MIN(service_date) of billable daily supplies for customers
    // whose computed balance > 0. We compute this in one query.
    const rows = await prisma.$queryRaw<Array<{ customer_id: bigint; oldest: Date | null }>>`
      SELECT slc.customer_id, MIN(ds.service_date) AS oldest
      FROM daily_supplies ds
      JOIN supply_list_customers slc ON slc.id = ds.supply_list_customer_id
      WHERE ds.vendor_id = ${vendorId}
        AND slc.customer_id = ANY(${customerIds})
        AND ds.status IN ('DELIVERED','AUTO_MARKED')
      GROUP BY slc.customer_id
    `;

    const result = new Map<string, Date | null>();
    for (const cid of customerIds) {
      result.set(cid.toString(), null);
    }
    for (const row of rows) {
      result.set(row.customer_id.toString(), row.oldest ?? null);
    }
    return result;
  }

  async getMonthlyBilled(vendorId: bigint, month: string): Promise<number> {
    const { start, end } = monthRange(month);
    const agg = await prisma.dailySupply.aggregate({
      where: {
        vendorId,
        status: { in: ['DELIVERED', 'AUTO_MARKED'] },
        serviceDate: { gte: start, lt: end },
      },
      _sum: { finalAmount: true },
    });
    return toNum(agg._sum?.finalAmount);
  }

  async getMonthlyCollected(vendorId: bigint, month: string): Promise<number> {
    const { start, end } = monthRange(month);
    const agg = await prisma.payment.aggregate({
      where: {
        vendorId,
        paymentDate: { gte: start, lt: end },
      },
      _sum: { amount: true },
    });
    return toNum(agg._sum?.amount);
  }

  async getPaymentModeBreakdown(
    vendorId: bigint,
    month: string
  ): Promise<PaymentModeBreakdownRow[]> {
    const { start, end } = monthRange(month);
    const rows = await prisma.$queryRaw<Array<{ payment_method: string; total: string }>>`
      SELECT payment_method, SUM(amount)::text AS total
      FROM payments
      WHERE vendor_id = ${vendorId}
        AND payment_date >= ${start}
        AND payment_date < ${end}
      GROUP BY payment_method
    `;

    const total = rows.reduce((s, r) => s + toNum(r.total), 0);

    const modes = ['UPI', 'CASH', 'BANK', 'ONLINE', 'OTHER'];
    return modes.map((mode) => {
      const row = rows.find((r) => r.payment_method.toUpperCase() === mode);
      const amount = row ? toNum(row.total) : 0;
      return {
        mode: mode.toLowerCase(),
        amount,
        percentage: total > 0 ? Math.round((amount / total) * 100) : 0,
      };
    });
  }

  async getCollectionTrend(vendorId: bigint, months: string[]): Promise<CollectionTrendRow[]> {
    // Fetch all months concurrently instead of sequentially (avoids N+1 round-trips)
    return Promise.all(
      months.map(async (month) => {
        const [billed, collected] = await Promise.all([
          this.getMonthlyBilled(vendorId, month),
          this.getMonthlyCollected(vendorId, month),
        ]);
        return {
          month,
          percentage: billed > 0 ? Math.round((collected / billed) * 100) : 0,
        };
      })
    );
  }

  async getTopPayers(vendorId: bigint, month: string, limit: number): Promise<TopPayerRow[]> {
    const { start, end } = monthRange(month);
    const rows = await prisma.$queryRaw<
      Array<{ customer_id: bigint; name: string | null; total: string }>
    >`
      SELECT p.customer_id, c.name, SUM(p.amount)::text AS total
      FROM payments p
      JOIN customers c ON c.id = p.customer_id
      WHERE p.vendor_id = ${vendorId}
        AND p.payment_date >= ${start}
        AND p.payment_date < ${end}
      GROUP BY p.customer_id, c.name
      ORDER BY SUM(p.amount) DESC
      LIMIT ${limit}
    `;

    return rows.map((r) => ({
      customerId: r.customer_id,
      customerName: r.name ?? 'Unknown',
      amount: toNum(r.total),
    }));
  }
}
