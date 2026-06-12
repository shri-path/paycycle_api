import { ICustomerRepository, CustomerListParams } from '../../database/customer.repository.port';
import { IDeliveryBillingPort } from '../../ports/delivery-billing.port';
import { CustomerMapper } from '../../customer.mapper';
import { CustomerListItemDto } from '../../customer.types';

export interface ListCustomersInput {
  vendorId: bigint;
  isOwner: boolean;
  staffListIds?: bigint[] | undefined;
  search?: string | undefined;
  listId?: bigint | undefined;
  paymentStatusFilter?: string | undefined;
  page: number;
  limit: number;
}

export interface ListCustomersResult {
  total: number;
  customers: CustomerListItemDto[];
}

export class ListCustomersQuery {
  constructor(
    private readonly repository: ICustomerRepository,
    private readonly billingPort: IDeliveryBillingPort
  ) {}

  async execute(input: ListCustomersInput): Promise<ListCustomersResult> {
    const params: CustomerListParams = {
      vendorId: input.vendorId,
      search: input.search,
      listId: input.listId,
      page: input.page,
      limit: input.limit,
      staffListIds: input.isOwner ? undefined : (input.staffListIds ?? []),
    };

    const { rows, total } = await this.repository.listCustomers(params);

    if (rows.length === 0) return { total, customers: [] };

    // Fetch balances in bulk (N+1-free) — only for owner
    let balanceMap = new Map<string, number>();
    const monthlyMap = new Map<string, number>();
    if (input.isOwner) {
      const ids = rows.map((r) => r.id);
      balanceMap = await this.billingPort.getBulkBalances(ids, input.vendorId);
      // Monthly totals — accept N per page (page is small, typically 20)
      const monthlyResults = await Promise.all(
        ids.map(async (id) => ({
          id: id.toString(),
          total: await this.billingPort.getCurrentMonthTotal(id, input.vendorId),
        }))
      );
      for (const { id, total: t } of monthlyResults) {
        monthlyMap.set(id, t);
      }
    }

    const customers = rows.map((row) => {
      const balance = input.isOwner ? (balanceMap.get(row.id.toString()) ?? 0) : null;
      const monthlyTotal = input.isOwner ? (monthlyMap.get(row.id.toString()) ?? 0) : null;
      return CustomerMapper.toListItemDto(row, balance, monthlyTotal);
    });

    // Apply paymentStatus filter (post-compute, since it depends on balance)
    const filtered =
      input.paymentStatusFilter && input.paymentStatusFilter !== 'all'
        ? customers.filter((c) => c.paymentStatus === input.paymentStatusFilter)
        : customers;

    return { total, customers: filtered };
  }
}
