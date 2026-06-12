import { PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { CustomerEntity, PaymentEntity } from '../domain/customer.entity';

export interface CustomerListParams {
  vendorId: bigint;
  search?: string | undefined;
  listId?: bigint | undefined;
  page: number;
  limit: number;
  /** IDs of supply lists the staff member is assigned to (undefined = owner, sees all) */
  staffListIds?: bigint[] | undefined;
}

export interface CustomerRow {
  id: bigint;
  name: string | null;
  phone: string;
  phoneCountryCode: string;
  email: string | null;
  address: string | null;
  area: string | null;
  locality: string | null;
  languagePreference: string;
  creditLimit: number;
  paymentScore: number;
  customerSince: Date | null;
  status: string;
  createdByUserId: bigint | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  vendorId: bigint;
  /** Supply list names the customer is subscribed to */
  supplyListNames: string[];
}

export interface CustomerDetailRow extends CustomerRow {
  subscriptions: SubscriptionRow[];
}

export interface SubscriptionRow {
  id: bigint;
  supplyListId: bigint;
  supplyListName: string;
  startTime: string | null;
  customQuantity: number | null;
  defaultQuantity: number | null;
  unit: string;
  customRatePerUnit: number | null;
  defaultRatePerUnit: number | null;
  frequency: string;
  startDate: Date | null;
  endDate: Date | null;
  isActive: boolean;
}

export interface PaymentRow {
  id: bigint;
  customerId: bigint;
  vendorId: bigint;
  amount: number;
  paymentDate: Date;
  paymentMethod: string;
  referenceNumber: string | null;
  recordedByUserId: bigint | null;
  createdAt: Date;
}

export interface InsertSubscriptionInput {
  vendorId: bigint;
  supplyListId: bigint;
  customerId: bigint;
  startDate?: Date | null | undefined;
  customQuantity?: number | null | undefined;
  customRatePerUnit?: number | null | undefined;
}

export interface ICustomerRepository {
  findById(id: bigint, vendorId: bigint, tx?: PrismaTransaction): Promise<CustomerRow | null>;
  findByPhone(phone: string, vendorId: bigint, tx?: PrismaTransaction): Promise<CustomerRow | null>;

  insert(
    entity: CustomerEntity,
    vendorId: bigint,
    supplyListIds: bigint[],
    startDate: Date | null,
    tx?: PrismaTransaction
  ): Promise<CustomerRow>;

  update(entity: CustomerEntity, tx?: PrismaTransaction): Promise<void>;

  deactivate(id: bigint, deletedAt: Date, tx?: PrismaTransaction): Promise<void>;

  listCustomers(
    params: CustomerListParams,
    tx?: PrismaTransaction
  ): Promise<{ rows: CustomerRow[]; total: number }>;

  getCustomerWithDetail(
    id: bigint,
    vendorId: bigint,
    tx?: PrismaTransaction
  ): Promise<CustomerDetailRow | null>;

  insertPayment(entity: PaymentEntity, tx?: PrismaTransaction): Promise<PaymentRow>;

  listPayments(
    customerId: bigint,
    vendorId: bigint,
    page: number,
    limit: number,
    tx?: PrismaTransaction
  ): Promise<{ rows: PaymentRow[]; total: number }>;

  insertSubscription(
    input: InsertSubscriptionInput,
    tx?: PrismaTransaction
  ): Promise<SubscriptionRow>;

  findActiveSubscription(
    customerId: bigint,
    supplyListId: bigint,
    tx?: PrismaTransaction
  ): Promise<SubscriptionRow | null>;

  findSubscriptionById(
    subscriptionId: bigint,
    vendorId: bigint,
    tx?: PrismaTransaction
  ): Promise<SubscriptionRow | null>;

  endSubscription(subscriptionId: bigint, endDate: Date, tx?: PrismaTransaction): Promise<void>;

  transaction<T>(fn: (tx: PrismaTransaction) => Promise<T>): Promise<T>;
}
