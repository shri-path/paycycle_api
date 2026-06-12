import { Prisma } from '@prisma/client';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import { ConflictError } from '@/common/errors/app-error';
import { CustomerEntity, PaymentEntity } from '../domain/customer.entity';
import {
  ICustomerRepository,
  CustomerRow,
  CustomerDetailRow,
  SubscriptionRow,
  PaymentRow,
  CustomerListParams,
  InsertSubscriptionInput,
} from './customer.repository.port';

function toNum(d: Prisma.Decimal | null | undefined): number {
  return d == null ? 0 : Number(d.toString());
}

function mapToCustomerRow(
  c: {
    id: bigint;
    name: string | null;
    phone: string;
    phoneCountryCode: string;
    email: string | null;
    address: string | null;
    area: string | null;
    locality: string | null;
    languagePreference: string;
    creditLimit: Prisma.Decimal;
    paymentScore: Prisma.Decimal;
    customerSince: Date | null;
    status: string;
    createdByUserId: bigint | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  },
  vendorId: bigint,
  supplyListNames: string[] = []
): CustomerRow {
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    phoneCountryCode: c.phoneCountryCode,
    email: c.email,
    address: c.address,
    area: c.area,
    locality: c.locality,
    languagePreference: c.languagePreference,
    creditLimit: toNum(c.creditLimit),
    paymentScore: toNum(c.paymentScore),
    customerSince: c.customerSince,
    status: c.status,
    createdByUserId: c.createdByUserId,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    deletedAt: c.deletedAt,
    vendorId,
    supplyListNames,
  };
}

export class CustomerRepository implements ICustomerRepository {
  private db(tx?: PrismaTransaction) {
    return tx ?? prisma;
  }

  async findById(
    id: bigint,
    vendorId: bigint,
    tx?: PrismaTransaction
  ): Promise<CustomerRow | null> {
    const row = await this.db(tx).customer.findFirst({
      where: {
        id,
        deletedAt: null,
        vendorCustomers: { some: { vendorId, deletedAt: null } },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        phoneCountryCode: true,
        email: true,
        address: true,
        area: true,
        locality: true,
        languagePreference: true,
        creditLimit: true,
        paymentScore: true,
        customerSince: true,
        status: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
    if (!row) return null;
    return mapToCustomerRow(row, vendorId);
  }

  async findByPhone(
    phone: string,
    vendorId: bigint,
    tx?: PrismaTransaction
  ): Promise<CustomerRow | null> {
    const row = await this.db(tx).customer.findFirst({
      where: {
        phone,
        deletedAt: null,
        vendorCustomers: { some: { vendorId, deletedAt: null } },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        phoneCountryCode: true,
        email: true,
        address: true,
        area: true,
        locality: true,
        languagePreference: true,
        creditLimit: true,
        paymentScore: true,
        customerSince: true,
        status: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
      },
    });
    if (!row) return null;
    return mapToCustomerRow(row, vendorId);
  }

  async insert(
    entity: CustomerEntity,
    vendorId: bigint,
    supplyListIds: bigint[],
    startDate: Date | null,
    tx?: PrismaTransaction
  ): Promise<CustomerRow> {
    const run = async (client: PrismaTransaction): Promise<CustomerRow> => {
      const props = entity.getProps();
      try {
        const created = await client.customer.create({
          data: {
            name: props.name.unpack(),
            phone: props.phone.unpack(),
            phoneCountryCode: props.phoneCountryCode,
            email: props.email,
            address: props.address,
            area: props.area,
            locality: props.area,
            languagePreference: props.languagePreference,
            creditLimit: props.creditLimit.unpack(),
            paymentScore: props.paymentScore.unpack(),
            customerSince: props.customerSince,
            status: props.status,
            createdByUserId: props.createdByUserId,
          },
          select: {
            id: true,
            name: true,
            phone: true,
            phoneCountryCode: true,
            email: true,
            address: true,
            area: true,
            locality: true,
            languagePreference: true,
            creditLimit: true,
            paymentScore: true,
            customerSince: true,
            status: true,
            createdByUserId: true,
            createdAt: true,
            updatedAt: true,
            deletedAt: true,
          },
        });

        // Create vendor-customer relationship
        await client.vendorCustomer.create({
          data: { vendorId, customerId: created.id },
        });

        // Enroll in supply lists
        if (supplyListIds.length > 0) {
          await client.supplyListCustomer.createMany({
            data: supplyListIds.map((slId) => ({
              vendorId,
              supplyListId: slId,
              customerId: created.id,
              startDate: startDate ?? new Date(),
              isActive: true,
            })),
            skipDuplicates: true,
          });
        }

        return mapToCustomerRow(created, vendorId);
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictError('A customer with this phone number already exists');
        }
        throw err;
      }
    };

    if (tx) return run(tx);
    return this.transaction(run);
  }

  async update(entity: CustomerEntity, tx?: PrismaTransaction): Promise<void> {
    const props = entity.getProps();
    try {
      await this.db(tx).customer.update({
        where: { id: props.id },
        data: {
          name: props.name.unpack(),
          phone: props.phone.unpack(),
          phoneCountryCode: props.phoneCountryCode,
          email: props.email,
          address: props.address,
          area: props.area,
          languagePreference: props.languagePreference,
          creditLimit: props.creditLimit.unpack(),
          status: props.status,
          deletedAt: props.deletedAt,
          updatedAt: props.updatedAt,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('A customer with this phone number already exists');
      }
      throw err;
    }
  }

  async deactivate(id: bigint, deletedAt: Date, tx?: PrismaTransaction): Promise<void> {
    const run = async (client: PrismaTransaction): Promise<void> => {
      await client.customer.update({
        where: { id },
        data: { status: 'INACTIVE', deletedAt },
      });
      // End all active subscriptions
      await client.supplyListCustomer.updateMany({
        where: { customerId: id, isActive: true },
        data: { isActive: false, endDate: deletedAt },
      });
    };
    if (tx) return run(tx);
    return this.transaction(run);
  }

  async listCustomers(
    params: CustomerListParams,
    tx?: PrismaTransaction
  ): Promise<{ rows: CustomerRow[]; total: number }> {
    const { vendorId, search, listId, page, limit, staffListIds } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      vendorCustomers: { some: { vendorId, deletedAt: null } },
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    if (listId || staffListIds !== undefined) {
      const listFilter = listId ? [listId] : (staffListIds ?? []);
      where.supplyListCustomers = {
        some: {
          supplyListId: { in: listFilter },
          isActive: true,
        },
      };
    }

    const [total, customers] = await Promise.all([
      this.db(tx).customer.count({ where }),
      this.db(tx).customer.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          phone: true,
          phoneCountryCode: true,
          email: true,
          address: true,
          area: true,
          locality: true,
          languagePreference: true,
          creditLimit: true,
          paymentScore: true,
          customerSince: true,
          status: true,
          createdByUserId: true,
          createdAt: true,
          updatedAt: true,
          deletedAt: true,
          supplyListCustomers: {
            where: { isActive: true },
            select: { supplyList: { select: { name: true } } },
          },
        },
      }),
    ]);

    const rows: CustomerRow[] = customers.map((c) =>
      mapToCustomerRow(
        c,
        vendorId,
        c.supplyListCustomers.map((slc) => slc.supplyList.name)
      )
    );

    return { rows, total };
  }

  async getCustomerWithDetail(
    id: bigint,
    vendorId: bigint,
    tx?: PrismaTransaction
  ): Promise<CustomerDetailRow | null> {
    const c = await this.db(tx).customer.findFirst({
      where: {
        id,
        deletedAt: null,
        vendorCustomers: { some: { vendorId, deletedAt: null } },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        phoneCountryCode: true,
        email: true,
        address: true,
        area: true,
        locality: true,
        languagePreference: true,
        creditLimit: true,
        paymentScore: true,
        customerSince: true,
        status: true,
        createdByUserId: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        supplyListCustomers: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            supplyListId: true,
            customQuantity: true,
            customRatePerUnit: true,
            startDate: true,
            endDate: true,
            isActive: true,
            supplyList: {
              select: {
                name: true,
                startTime: true,
                unit: true,
                defaultQuantity: true,
                ratePerUnit: true,
                frequency: true,
              },
            },
          },
        },
      },
    });

    if (!c) return null;

    const subscriptions: SubscriptionRow[] = c.supplyListCustomers.map((slc) => ({
      id: slc.id,
      supplyListId: slc.supplyListId,
      supplyListName: slc.supplyList.name,
      startTime: slc.supplyList.startTime,
      customQuantity: toNum(slc.customQuantity) || null,
      defaultQuantity: toNum(slc.supplyList.defaultQuantity) || null,
      unit: slc.supplyList.unit,
      customRatePerUnit: toNum(slc.customRatePerUnit) || null,
      defaultRatePerUnit: toNum(slc.supplyList.ratePerUnit) || null,
      frequency: slc.supplyList.frequency,
      startDate: slc.startDate,
      endDate: slc.endDate,
      isActive: slc.isActive,
    }));

    return {
      ...mapToCustomerRow(
        c,
        vendorId,
        subscriptions.filter((s) => s.isActive).map((s) => s.supplyListName)
      ),
      subscriptions,
    };
  }

  async insertPayment(entity: PaymentEntity, tx?: PrismaTransaction): Promise<PaymentRow> {
    const props = entity.getProps();
    const created = await this.db(tx).payment.create({
      data: {
        customerId: props.customerId,
        vendorId: props.vendorId,
        amount: props.amount,
        paymentDate: props.paymentDate,
        paymentMethod: props.paymentMethod,
        referenceNumber: props.referenceNumber,
        recordedByUserId: props.recordedByUserId,
      },
      select: {
        id: true,
        customerId: true,
        vendorId: true,
        amount: true,
        paymentDate: true,
        paymentMethod: true,
        referenceNumber: true,
        recordedByUserId: true,
        createdAt: true,
      },
    });
    return {
      ...created,
      amount: toNum(created.amount),
    };
  }

  async listPayments(
    customerId: bigint,
    vendorId: bigint,
    page: number,
    limit: number,
    tx?: PrismaTransaction
  ): Promise<{ rows: PaymentRow[]; total: number }> {
    const skip = (page - 1) * limit;
    const where = { customerId, vendorId };

    const [total, payments] = await Promise.all([
      this.db(tx).payment.count({ where }),
      this.db(tx).payment.findMany({
        where,
        skip,
        take: limit,
        orderBy: { paymentDate: 'desc' },
        select: {
          id: true,
          customerId: true,
          vendorId: true,
          amount: true,
          paymentDate: true,
          paymentMethod: true,
          referenceNumber: true,
          recordedByUserId: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      rows: payments.map((p) => ({ ...p, amount: toNum(p.amount) })),
      total,
    };
  }

  async insertSubscription(
    input: InsertSubscriptionInput,
    tx?: PrismaTransaction
  ): Promise<SubscriptionRow> {
    try {
      const slc = await this.db(tx).supplyListCustomer.create({
        data: {
          vendorId: input.vendorId,
          supplyListId: input.supplyListId,
          customerId: input.customerId,
          startDate: input.startDate ?? new Date(),
          ...(input.customQuantity != null ? { customQuantity: input.customQuantity } : {}),
          ...(input.customRatePerUnit != null
            ? { customRatePerUnit: input.customRatePerUnit }
            : {}),
          isActive: true,
        },
        include: {
          supplyList: {
            select: {
              name: true,
              startTime: true,
              unit: true,
              defaultQuantity: true,
              ratePerUnit: true,
              frequency: true,
            },
          },
        },
      });
      return {
        id: slc.id,
        supplyListId: slc.supplyListId,
        supplyListName: slc.supplyList.name,
        startTime: slc.supplyList.startTime,
        customQuantity: toNum(slc.customQuantity) || null,
        defaultQuantity: toNum(slc.supplyList.defaultQuantity) || null,
        unit: slc.supplyList.unit,
        customRatePerUnit: toNum(slc.customRatePerUnit) || null,
        defaultRatePerUnit: toNum(slc.supplyList.ratePerUnit) || null,
        frequency: slc.supplyList.frequency,
        startDate: slc.startDate,
        endDate: slc.endDate,
        isActive: slc.isActive,
      };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('Customer is already subscribed to this supply list');
      }
      throw err;
    }
  }

  async findActiveSubscription(
    customerId: bigint,
    supplyListId: bigint,
    tx?: PrismaTransaction
  ): Promise<SubscriptionRow | null> {
    const slc = await this.db(tx).supplyListCustomer.findFirst({
      where: { customerId, supplyListId, isActive: true },
      select: {
        id: true,
        supplyListId: true,
        customQuantity: true,
        customRatePerUnit: true,
        startDate: true,
        endDate: true,
        isActive: true,
        supplyList: {
          select: {
            name: true,
            startTime: true,
            unit: true,
            defaultQuantity: true,
            ratePerUnit: true,
            frequency: true,
          },
        },
      },
    });
    if (!slc) return null;
    return {
      id: slc.id,
      supplyListId: slc.supplyListId,
      supplyListName: slc.supplyList.name,
      startTime: slc.supplyList.startTime,
      customQuantity: toNum(slc.customQuantity) || null,
      defaultQuantity: toNum(slc.supplyList.defaultQuantity) || null,
      unit: slc.supplyList.unit,
      customRatePerUnit: toNum(slc.customRatePerUnit) || null,
      defaultRatePerUnit: toNum(slc.supplyList.ratePerUnit) || null,
      frequency: slc.supplyList.frequency,
      startDate: slc.startDate,
      endDate: slc.endDate,
      isActive: slc.isActive,
    };
  }

  async findSubscriptionById(
    subscriptionId: bigint,
    vendorId: bigint,
    tx?: PrismaTransaction
  ): Promise<SubscriptionRow | null> {
    const slc = await this.db(tx).supplyListCustomer.findFirst({
      where: { id: subscriptionId, vendorId },
      select: {
        id: true,
        supplyListId: true,
        customQuantity: true,
        customRatePerUnit: true,
        startDate: true,
        endDate: true,
        isActive: true,
        supplyList: {
          select: {
            name: true,
            startTime: true,
            unit: true,
            defaultQuantity: true,
            ratePerUnit: true,
            frequency: true,
          },
        },
      },
    });
    if (!slc) return null;
    return {
      id: slc.id,
      supplyListId: slc.supplyListId,
      supplyListName: slc.supplyList.name,
      startTime: slc.supplyList.startTime,
      customQuantity: toNum(slc.customQuantity) || null,
      defaultQuantity: toNum(slc.supplyList.defaultQuantity) || null,
      unit: slc.supplyList.unit,
      customRatePerUnit: toNum(slc.customRatePerUnit) || null,
      defaultRatePerUnit: toNum(slc.supplyList.ratePerUnit) || null,
      frequency: slc.supplyList.frequency,
      startDate: slc.startDate,
      endDate: slc.endDate,
      isActive: slc.isActive,
    };
  }

  async endSubscription(
    subscriptionId: bigint,
    endDate: Date,
    tx?: PrismaTransaction
  ): Promise<void> {
    await this.db(tx).supplyListCustomer.update({
      where: { id: subscriptionId },
      data: { isActive: false, endDate },
    });
  }

  async transaction<T>(fn: (tx: PrismaTransaction) => Promise<T>): Promise<T> {
    return prisma.$transaction((c) => fn(c as unknown as PrismaTransaction));
  }
}
