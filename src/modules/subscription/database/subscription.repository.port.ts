/**
 * ISubscriptionRepository port — domain depends on this interface, not Prisma.
 */
import { VendorSubscriptionEntity } from '../domain/subscription.entity';
import { AppendHistoryInput, InvoiceInsertInput } from '../domain/subscription.types';
import { PrismaTransaction } from '@/infrastructure/database/prisma.client';

export interface VendorSubscriptionRow {
  id: bigint;
  vendorId: bigint;
  subscriptionPlanId: bigint;
  billingCycle: string;
  startDate: Date;
  endDate: Date | null;
  nextBillingDate: Date | null;
  status: string;
  amountPaid: number;
  autoRenewal: boolean;
  isTrial: boolean;
  trialEndsAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface InvoiceRow {
  id: bigint;
  vendorSubscriptionId: bigint;
  vendorId: bigint;
  invoiceNumber: string;
  amount: number;
  tax: number;
  totalAmount: number;
  invoiceDate: Date;
  dueDate: Date;
  paymentStatus: string;
  paymentDate: Date | null;
  paymentMethod: string | null;
  paymentReference: string | null;
  createdAt: Date;
}

export interface HistoryRow {
  id: bigint;
  vendorSubscriptionId: bigint;
  eventType: string;
  oldPlanId: bigint | null;
  newPlanId: bigint | null;
  reason: string | null;
  performedByUserId: bigint | null;
  createdAt: Date;
}

export interface ISubscriptionRepository {
  findActiveByVendor(
    vendorId: bigint,
    tx?: PrismaTransaction
  ): Promise<VendorSubscriptionRow | null>;

  findLatestExpiredByVendor(
    vendorId: bigint,
    tx?: PrismaTransaction
  ): Promise<VendorSubscriptionRow | null>;

  findDueSubscriptions(today: Date, tx?: PrismaTransaction): Promise<VendorSubscriptionRow[]>;

  generateInvoiceNumber(vendorId: bigint, today: Date, tx: PrismaTransaction): Promise<string>;

  /** Upgrade: close old + persist new in one transaction. */
  closeAndOpen(
    oldEntity: VendorSubscriptionEntity,
    newEntity: VendorSubscriptionEntity,
    tx: PrismaTransaction
  ): Promise<{ old: VendorSubscriptionRow; new: VendorSubscriptionRow }>;

  persist(entity: VendorSubscriptionEntity, tx?: PrismaTransaction): Promise<VendorSubscriptionRow>;

  appendHistory(input: AppendHistoryInput, tx?: PrismaTransaction): Promise<void>;

  insertInvoice(input: InvoiceInsertInput, tx?: PrismaTransaction): Promise<InvoiceRow>;

  listInvoices(
    vendorId: bigint,
    page: number,
    limit: number,
    tx?: PrismaTransaction
  ): Promise<{ rows: InvoiceRow[]; total: number }>;

  listHistory(
    vendorId: bigint,
    page: number,
    limit: number,
    tx?: PrismaTransaction
  ): Promise<{ rows: HistoryRow[]; total: number }>;

  transaction<T>(fn: (tx: PrismaTransaction) => Promise<T>): Promise<T>;
}
