/**
 * Prisma adapter for ISubscriptionRepository.
 * All queries are vendor-scoped. P2002 on partial-unique → ConflictError.
 */
import {
  Prisma,
  VendorSubscriptionStatus as PrismaVendorSubscriptionStatus,
  BillingCycle as PrismaBillingCycle,
  InvoicePaymentStatus as PrismaInvoicePaymentStatus,
  SubscriptionEventType as PrismaSubscriptionEventType,
} from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { ConflictError } from '@/common/errors/app-error';
import { VendorSubscriptionEntity } from '../domain/subscription.entity';
import {
  ISubscriptionRepository,
  VendorSubscriptionRow,
  InvoiceRow,
  HistoryRow,
} from './subscription.repository.port';
import { AppendHistoryInput, InvoiceInsertInput } from '../domain/subscription.types';

const ACTIVE_STATUSES: PrismaVendorSubscriptionStatus[] = [
  PrismaVendorSubscriptionStatus.TRIAL,
  PrismaVendorSubscriptionStatus.ACTIVE,
  PrismaVendorSubscriptionStatus.PAST_DUE,
];

function toRow(r: {
  id: bigint;
  vendorId: bigint;
  subscriptionPlanId: bigint;
  billingCycle: string;
  startDate: Date;
  endDate: Date | null;
  nextBillingDate: Date | null;
  status: string;
  amountPaid: { toNumber(): number };
  autoRenewal: boolean;
  isTrial: boolean;
  trialEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): VendorSubscriptionRow {
  return {
    id: r.id,
    vendorId: r.vendorId,
    subscriptionPlanId: r.subscriptionPlanId,
    billingCycle: r.billingCycle,
    startDate: r.startDate,
    endDate: r.endDate,
    nextBillingDate: r.nextBillingDate,
    status: r.status,
    amountPaid: r.amountPaid.toNumber(),
    autoRenewal: r.autoRenewal,
    isTrial: r.isTrial,
    trialEndsAt: r.trialEndsAt,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function toInvoiceRow(r: {
  id: bigint;
  vendorSubscriptionId: bigint;
  vendorId: bigint;
  invoiceNumber: string;
  amount: { toNumber(): number };
  tax: { toNumber(): number };
  totalAmount: { toNumber(): number };
  invoiceDate: Date;
  dueDate: Date;
  paymentStatus: string;
  paymentDate: Date | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  createdAt: Date;
}): InvoiceRow {
  return {
    id: r.id,
    vendorSubscriptionId: r.vendorSubscriptionId,
    vendorId: r.vendorId,
    invoiceNumber: r.invoiceNumber,
    amount: r.amount.toNumber(),
    tax: r.tax.toNumber(),
    totalAmount: r.totalAmount.toNumber(),
    invoiceDate: r.invoiceDate,
    dueDate: r.dueDate,
    paymentStatus: r.paymentStatus,
    paymentDate: r.paymentDate,
    paymentMethod: r.paymentMethod,
    paymentReference: r.paymentReference,
    createdAt: r.createdAt,
  };
}

function entityToPersistenceCreate(entity: VendorSubscriptionEntity) {
  const p = entity.getProps();
  return {
    vendorId: p.vendorId,
    subscriptionPlanId: p.subscriptionPlanId,
    billingCycle: p.billingCycle as PrismaBillingCycle,
    startDate: p.startDate,
    endDate: p.endDate,
    nextBillingDate: p.nextBillingDate,
    status: p.status as PrismaVendorSubscriptionStatus,
    amountPaid: p.amountPaid,
    autoRenewal: p.autoRenewal,
    isTrial: p.isTrial,
    trialEndsAt: p.trialEndsAt,
  };
}

function entityToPersistenceUpdate(entity: VendorSubscriptionEntity) {
  const p = entity.getProps();
  return {
    billingCycle: p.billingCycle as PrismaBillingCycle,
    startDate: p.startDate,
    endDate: p.endDate,
    nextBillingDate: p.nextBillingDate,
    status: p.status as PrismaVendorSubscriptionStatus,
    amountPaid: p.amountPaid,
    autoRenewal: p.autoRenewal,
    isTrial: p.isTrial,
    trialEndsAt: p.trialEndsAt,
  };
}

export class SubscriptionRepository implements ISubscriptionRepository {
  async findActiveByVendor(
    vendorId: bigint,
    tx?: PrismaTransaction
  ): Promise<VendorSubscriptionRow | null> {
    const db = tx ?? prisma;
    const row = await db.vendorSubscription.findFirst({
      where: {
        vendorId,
        status: { in: ACTIVE_STATUSES },
        endDate: null,
      },
    });
    return row ? toRow(row) : null;
  }

  async findDueSubscriptions(
    today: Date,
    tx?: PrismaTransaction
  ): Promise<VendorSubscriptionRow[]> {
    const db = tx ?? prisma;
    const rows = await db.vendorSubscription.findMany({
      where: {
        status: PrismaVendorSubscriptionStatus.ACTIVE,
        nextBillingDate: { lte: today },
        endDate: null,
      },
    });
    return rows.map(toRow);
  }

  async closeAndOpen(
    oldEntity: VendorSubscriptionEntity,
    newEntity: VendorSubscriptionEntity,
    tx: PrismaTransaction
  ): Promise<{ old: VendorSubscriptionRow; new: VendorSubscriptionRow }> {
    try {
      const updated = await tx.vendorSubscription.update({
        where: { id: oldEntity.id },
        data: entityToPersistenceUpdate(oldEntity),
      });

      const created = await tx.vendorSubscription.create({
        data: entityToPersistenceCreate(newEntity),
      });

      newEntity.assignId(created.id);

      return { old: toRow(updated), new: toRow(created) };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('Subscription already active');
      }
      throw err;
    }
  }

  async persist(
    entity: VendorSubscriptionEntity,
    tx?: PrismaTransaction
  ): Promise<VendorSubscriptionRow> {
    const db = tx ?? prisma;
    try {
      if (entity.id === 0n) {
        const created = await db.vendorSubscription.create({
          data: entityToPersistenceCreate(entity),
        });
        entity.assignId(created.id);
        return toRow(created);
      }
      const updated = await db.vendorSubscription.update({
        where: { id: entity.id },
        data: entityToPersistenceUpdate(entity),
      });
      return toRow(updated);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('Subscription already active');
      }
      throw err;
    }
  }

  async appendHistory(input: AppendHistoryInput, tx?: PrismaTransaction): Promise<void> {
    const db = tx ?? prisma;
    await db.vendorSubscriptionHistory.create({
      data: {
        vendorSubscriptionId: input.vendorSubscriptionId,
        eventType: input.eventType as PrismaSubscriptionEventType,
        oldPlanId: input.oldPlanId ?? null,
        newPlanId: input.newPlanId ?? null,
        reason: input.reason ?? null,
        performedByUserId: input.performedByUserId ?? null,
      },
    });
  }

  async insertInvoice(input: InvoiceInsertInput, tx?: PrismaTransaction): Promise<InvoiceRow> {
    const db = tx ?? prisma;
    const created = await db.subscriptionInvoice.create({
      data: {
        vendorSubscriptionId: input.vendorSubscriptionId,
        vendorId: input.vendorId,
        invoiceNumber: input.invoiceNumber,
        amount: input.amount,
        tax: input.tax,
        totalAmount: input.totalAmount,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate,
        paymentStatus: input.paymentStatus as PrismaInvoicePaymentStatus,
        paymentDate: input.paymentDate ?? null,
        paymentMethod: input.paymentMethod ?? null,
        paymentReference: input.paymentReference ?? null,
      },
    });
    return toInvoiceRow(created);
  }

  async listInvoices(
    vendorId: bigint,
    page: number,
    limit: number,
    tx?: PrismaTransaction
  ): Promise<{ rows: InvoiceRow[]; total: number }> {
    const db = tx ?? prisma;
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      db.subscriptionInvoice.findMany({
        where: { vendorId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.subscriptionInvoice.count({ where: { vendorId } }),
    ]);
    return { rows: rows.map(toInvoiceRow), total };
  }

  async listHistory(
    vendorId: bigint,
    page: number,
    limit: number,
    tx?: PrismaTransaction
  ): Promise<{ rows: HistoryRow[]; total: number }> {
    const db = tx ?? prisma;
    const skip = (page - 1) * limit;

    // Join through vendorSubscription to scope by vendorId
    const [rows, total] = await Promise.all([
      db.vendorSubscriptionHistory.findMany({
        where: { vendorSubscription: { vendorId } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.vendorSubscriptionHistory.count({ where: { vendorSubscription: { vendorId } } }),
    ]);

    return {
      rows: rows.map((r) => ({
        id: r.id,
        vendorSubscriptionId: r.vendorSubscriptionId,
        eventType: r.eventType,
        oldPlanId: r.oldPlanId,
        newPlanId: r.newPlanId,
        reason: r.reason,
        performedByUserId: r.performedByUserId,
        createdAt: r.createdAt,
      })),
      total,
    };
  }

  transaction<T>(fn: (tx: PrismaTransaction) => Promise<T>): Promise<T> {
    return prisma.$transaction(fn);
  }

  /** Generate invoice number: INV-YYYY-MM-<seq> within a transaction. */
  static async generateInvoiceNumber(
    vendorId: bigint,
    today: Date,
    tx: PrismaTransaction
  ): Promise<string> {
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const prefix = `INV-${year}-${month}`;

    const count = await tx.subscriptionInvoice.count({
      where: {
        vendorId,
        invoiceNumber: { startsWith: prefix },
      },
    });

    const seq = String(count + 1).padStart(3, '0');
    return `${prefix}-${seq}`;
  }
}
