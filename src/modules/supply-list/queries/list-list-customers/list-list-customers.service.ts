import { Logger } from '@/infrastructure/logger/logger';
import { config } from '@/infrastructure/config';
import { ISupplyListRepository } from '../../database/supply-list.repository.port';
import { ISubscriptionRepository } from '../../database/subscription.repository.port';
import { buildSubscriptionDtos } from '../../database/subscription-projection';
import { ListDefaults } from '../../domain/subscription.types';
import { SupplyListNotFoundError } from '../../domain/supply-list.errors';
import { CustomerDirectoryPort } from '../../ports/customer-directory.port';
import { SubscriptionDto } from '../../supply-list.types';

const DEFAULT_CUSTOMER_PAGE_SIZE = 50;

export interface ListListCustomersRequestDto {
  vendorId: bigint;
  listId: bigint;
  role: 'owner' | 'staff';
  callerStaffId: bigint;
  search?: string;
  status?: 'active' | 'paused' | 'ended';
  page?: number;
  limit?: number;
}

export interface ListListCustomersResult {
  data: SubscriptionDto[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export class ListListCustomersService {
  constructor(
    private readonly listRepository: ISupplyListRepository,
    private readonly subscriptionRepository: ISubscriptionRepository,
    private readonly customerDirectory: CustomerDirectoryPort,
    private readonly logger: Logger
  ) {}

  /** Query: subscriptions on a list (owner or assigned staff; 404-mask). */
  async execute(dto: ListListCustomersRequestDto): Promise<ListListCustomersResult> {
    const list = await this.listRepository.findById(dto.listId, dto.vendorId);
    // Archived (soft-deleted) lists are terminal (OQ-3): reject all reads with a 404 mask.
    if (!list || list.deletedAt !== null) {
      throw new SupplyListNotFoundError();
    }
    if (dto.role === 'staff' && !list.staff.some((s) => s.vendorUserId === dto.callerStaffId)) {
      throw new SupplyListNotFoundError();
    }

    const page = Math.max(1, dto.page ?? 1);
    const limit = Math.min(config.pagination.maxPageSize, dto.limit ?? DEFAULT_CUSTOMER_PAGE_SIZE);

    // Resolve search → matching customerIds within the vendor.
    let customerIds: bigint[] | undefined;
    if (dto.search) {
      const matches = await this.customerDirectory.listVendorCustomers(dto.vendorId, {
        search: dto.search,
        skip: 0,
        take: 500,
      });
      customerIds = matches.rows.map((r) => r.customerId);
      if (customerIds.length === 0) {
        return { data: [], meta: { page, limit, total: 0, totalPages: 0 } };
      }
    }

    const { rows, total } = await this.subscriptionRepository.list(dto.listId, dto.vendorId, {
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(customerIds !== undefined ? { customerIds } : {}),
      skip: (page - 1) * limit,
      take: limit,
    });

    const listDefaults: ListDefaults = {
      defaultQuantity:
        list.defaultQuantity === null ? null : Number(list.defaultQuantity.toString()),
      ratePerUnit: list.ratePerUnit === null ? null : Number(list.ratePerUnit.toString()),
    };

    const data = await buildSubscriptionDtos(
      rows,
      dto.vendorId,
      dto.listId,
      listDefaults,
      this.subscriptionRepository,
      this.customerDirectory
    );

    this.logger.info(
      { vendorId: dto.vendorId.toString(), listId: dto.listId.toString(), total },
      'ListListCustomersService: subscriptions listed'
    );

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }
}
