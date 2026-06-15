/**
 * Prisma adapter for SubscriptionInvoicePort.
 * Reads from subscription_invoices — does NOT import subscription module internals.
 */
import { prisma } from '@/infrastructure/database/prisma.client';
import { ISubscriptionInvoicePort, PaidInvoiceResult } from '../ports/subscription-invoice.port';

export class SubscriptionInvoiceAdapter implements ISubscriptionInvoicePort {
  async paidInvoiceForMonth(
    vendorId: bigint,
    yearMonth: string
  ): Promise<PaidInvoiceResult | null> {
    // yearMonth format: "YYYY-MM"
    const [year, month] = yearMonth.split('-').map(Number);
    if (!year || !month) return null;

    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59, 999);

    const invoice = await prisma.subscriptionInvoice.findFirst({
      where: {
        vendorId,
        paymentStatus: 'PAID',
        paymentDate: { gte: startDate, lte: endDate },
      },
      select: { id: true, amount: true, paymentDate: true },
      orderBy: { paymentDate: 'desc' },
    });

    if (!invoice || !invoice.paymentDate) return null;

    return {
      invoiceId: invoice.id,
      amount: Number(invoice.amount),
      paymentDate: invoice.paymentDate,
    };
  }

  async isSubscriptionChurned(vendorId: bigint): Promise<boolean> {
    const sub = await prisma.vendorSubscription.findFirst({
      where: { vendorId },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    });
    if (!sub) return true; // no subscription = churned
    return sub.status === 'CANCELLED' || sub.status === 'EXPIRED';
  }
}
