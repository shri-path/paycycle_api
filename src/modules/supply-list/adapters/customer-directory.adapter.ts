import { Prisma, VendorCustomerStatus } from '@prisma/client';
import { prisma } from '@/infrastructure/database/prisma.client';
import {
  CustomerDirectoryPort,
  CustomerInfo,
  ListVendorCustomersParams,
} from '../ports/customer-directory.port';

/**
 * Reads `customers` + `vendor_customers` directly (US-008 not built yet — OQ-1).
 * Swap to the US-008 facade when it ships.
 */
export class CustomerDirectoryAdapter implements CustomerDirectoryPort {
  async findCustomersNotInVendor(vendorId: bigint, customerIds: bigint[]): Promise<bigint[]> {
    if (customerIds.length === 0) return [];
    const rows = await prisma.vendorCustomer.findMany({
      where: {
        vendorId,
        customerId: { in: customerIds },
        deletedAt: null,
        status: { not: VendorCustomerStatus.BLOCKED },
      },
      select: { customerId: true },
    });
    const present = new Set(rows.map((r) => r.customerId.toString()));
    return customerIds.filter((id) => !present.has(id.toString()));
  }

  async getCustomerInfo(
    vendorId: bigint,
    customerIds: bigint[]
  ): Promise<Map<string, CustomerInfo>> {
    const map = new Map<string, CustomerInfo>();
    if (customerIds.length === 0) return map;
    const rows = await prisma.vendorCustomer.findMany({
      where: { vendorId, customerId: { in: customerIds }, deletedAt: null },
      select: {
        customerId: true,
        customer: { select: { name: true, phone: true, address: true } },
      },
    });
    for (const r of rows) {
      map.set(r.customerId.toString(), {
        customerId: r.customerId,
        name: r.customer.name,
        phone: r.customer.phone,
        address: r.customer.address,
      });
    }
    return map;
  }

  async listVendorCustomers(
    vendorId: bigint,
    params: ListVendorCustomersParams
  ): Promise<{ rows: CustomerInfo[]; total: number }> {
    const where: Prisma.VendorCustomerWhereInput = {
      vendorId,
      deletedAt: null,
      status: { not: VendorCustomerStatus.BLOCKED },
    };
    if (params.excludeCustomerIds && params.excludeCustomerIds.length > 0) {
      where.customerId = { notIn: params.excludeCustomerIds };
    }
    if (params.search) {
      where.customer = {
        OR: [
          { name: { contains: params.search, mode: 'insensitive' } },
          { phone: { contains: params.search } },
        ],
      };
    }

    const [rows, total] = await Promise.all([
      prisma.vendorCustomer.findMany({
        where,
        select: {
          customerId: true,
          customer: { select: { name: true, phone: true, address: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: params.skip,
        take: params.take,
      }),
      prisma.vendorCustomer.count({ where }),
    ]);

    return {
      rows: rows.map((r) => ({
        customerId: r.customerId,
        name: r.customer.name,
        phone: r.customer.phone,
        address: r.customer.address,
      })),
      total,
    };
  }
}
