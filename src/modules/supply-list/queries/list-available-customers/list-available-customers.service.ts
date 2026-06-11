import { Logger } from '@/infrastructure/logger/logger';
import { config } from '@/infrastructure/config';
import { ISupplyListRepository } from '../../database/supply-list.repository.port';
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { SupplyListNotFoundError } from '../../domain/supply-list.errors';
import { CustomerDirectoryPort } from '../../ports/customer-directory.port';
import { AvailableCustomerDto } from '../../supply-list.types';

const OTHER_LISTS_CAP = 5;

export interface ListAvailableCustomersRequestDto {
  vendorId: bigint;
  listId: bigint;
  search?: string;
  page?: number;
  limit?: number;
}

export interface ListAvailableCustomersResult {
  data: AvailableCustomerDto[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export class ListAvailableCustomersService {
  constructor(
    private readonly listRepository: ISupplyListRepository,
    private readonly subscriptionRepository: ISubscriptionRepository,
    private readonly customerDirectory: CustomerDirectoryPort,
    private readonly logger: Logger
  ) {}

  /** Query (owner only): vendor customers NOT already actively subscribed to this list. */
  async execute(dto: ListAvailableCustomersRequestDto): Promise<ListAvailableCustomersResult> {
    const list = await this.listRepository.findById(dto.listId, dto.vendorId);
    // Archived (soft-deleted) lists are terminal (OQ-3): reject all reads with a 404 mask.
    if (!list || list.deletedAt !== null) {
      throw new SupplyListNotFoundError();
    }

    const page = Math.max(1, dto.page ?? 1);
    const limit = Math.min(
      config.pagination.maxPageSize,
      dto.limit ?? config.pagination.defaultPageSize
    );

    const excludeCustomerIds =
      await this.subscriptionRepository.findNonEndedSubscriptionCustomerIds(dto.listId);

    const { rows, total } = await this.customerDirectory.listVendorCustomers(dto.vendorId, {
      ...(dto.search !== undefined ? { search: dto.search } : {}),
      excludeCustomerIds,
      skip: (page - 1) * limit,
      take: limit,
    });

    const otherLists = await this.subscriptionRepository.otherListNamesFor(
      dto.vendorId,
      rows.map((r) => r.customerId),
      dto.listId
    );

    const data: AvailableCustomerDto[] = rows.map((r) => {
      const names = otherLists.get(r.customerId.toString()) ?? [];
      return {
        customerId: r.customerId.toString(),
        name: r.name,
        phone: r.phone,
        otherLists: names.slice(0, OTHER_LISTS_CAP),
        otherListsCount: names.length,
      };
    });

    this.logger.info(
      { vendorId: dto.vendorId.toString(), listId: dto.listId.toString(), total },
      'ListAvailableCustomersService: available customers listed'
    );

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
}
