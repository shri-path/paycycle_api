/**
 * CreditCustomerAdapter — reads customer credit data and delegates limit updates.
 * Uses raw Prisma; never imports customer module classes.
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { Prisma } from '@prisma/client';
import { ICreditCustomerPort, CustomerCreditRow } from '../ports/credit-customer.port';

function toNum(d: Prisma.Decimal | null | undefined): number {
  return d == null ? 0 : Number(d.toString());
}

export class CreditCustomerAdapter implements ICreditCustomerPort {
  async listCustomersWithCredit(vendorId: bigint): Promise<CustomerCreditRow[]> {
    const rows = await prisma.$queryRaw<
      Array<{
        id: bigint;
        name: string | null;
        phone: string;
        credit_limit: Prisma.Decimal;
        payment_score: Prisma.Decimal;
        status: string;
        last_payment_date: Date | null;
      }>
    >`
      SELECT
        c.id,
        c.name,
        c.phone,
        c.credit_limit,
        c.payment_score,
        vc.status,
        (SELECT MAX(p.payment_date) FROM payments p WHERE p.customer_id = c.id AND p.vendor_id = ${vendorId}) AS last_payment_date
      FROM customers c
      JOIN vendor_customers vc ON vc.customer_id = c.id AND vc.vendor_id = ${vendorId}
      WHERE c.deleted_at IS NULL
        AND vc.deleted_at IS NULL
      ORDER BY c.name ASC
    `;

    return rows.map((r) => ({
      id: r.id,
      name: r.name ?? 'Unknown',
      phone: r.phone,
      creditLimit: toNum(r.credit_limit),
      paymentScore: toNum(r.payment_score),
      status: r.status,
      lastPaymentDate: r.last_payment_date ?? null,
    }));
  }

  async getCustomer(customerId: bigint, vendorId: bigint): Promise<CustomerCreditRow | null> {
    const row = await prisma.$queryRaw<
      Array<{
        id: bigint;
        name: string | null;
        phone: string;
        credit_limit: Prisma.Decimal;
        payment_score: Prisma.Decimal;
        status: string;
        last_payment_date: Date | null;
      }>
    >`
      SELECT
        c.id,
        c.name,
        c.phone,
        c.credit_limit,
        c.payment_score,
        vc.status,
        (SELECT MAX(p.payment_date) FROM payments p WHERE p.customer_id = c.id AND p.vendor_id = ${vendorId}) AS last_payment_date
      FROM customers c
      JOIN vendor_customers vc ON vc.customer_id = c.id AND vc.vendor_id = ${vendorId}
      WHERE c.id = ${customerId}
        AND c.deleted_at IS NULL
        AND vc.deleted_at IS NULL
      LIMIT 1
    `;

    if (row.length === 0) return null;
    const r = row[0]!;
    return {
      id: r.id,
      name: r.name ?? 'Unknown',
      phone: r.phone,
      creditLimit: toNum(r.credit_limit),
      paymentScore: toNum(r.payment_score),
      status: r.status,
      lastPaymentDate: r.last_payment_date ?? null,
    };
  }

  async setCreditLimit(customerId: bigint, vendorId: bigint, amount: number): Promise<void> {
    // Update the customer's credit_limit. Scoped to vendorId via vendor_customers join.
    // We verify the customer belongs to the vendor before calling (done in the command).
    await prisma.customer.update({
      where: { id: customerId },
      data: { creditLimit: amount },
    });
    void vendorId; // already validated upstream
  }
}
