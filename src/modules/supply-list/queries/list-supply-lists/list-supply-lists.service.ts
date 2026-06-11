import { Logger } from '@/infrastructure/logger/logger';
import { config } from '@/infrastructure/config';
import { ForbiddenError } from '@/common/errors/app-error';
import { ISupplyListRepository } from '../../database/supply-list.repository.port';
import { SupplyListMapper } from '../../database/supply-list.mapper';
import { DeliveryStatsPort } from '../../ports/delivery-stats.port';
import { SupplyListListDto } from '../../supply-list.types';

export interface ListSupplyListsRequestDto {
  vendorId: bigint;
  /** Caller role — 'owner' sees all, 'staff' sees only assigned. */
  role: 'owner' | 'staff';
  /** The caller's vendor_users.id (membership) — used for staff scoping. */
  callerStaffId: bigint;
  status?: 'active' | 'archived';
  /** Owner-only filter by a specific staff member. */
  staffId?: bigint;
  page?: number;
  limit?: number;
}

export interface ListSupplyListsResult {
  data: SupplyListListDto[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export class ListSupplyListsService {
  constructor(
    private readonly repository: ISupplyListRepository,
    private readonly deliveryStats: DeliveryStatsPort,
    private readonly logger: Logger
  ) {}

  /** Query: paginated supply lists. Owner→all; staff→assigned only. */
  async execute(dto: ListSupplyListsRequestDto): Promise<ListSupplyListsResult> {
    const page = Math.max(1, dto.page ?? 1);
    const limit = Math.min(
      config.pagination.maxPageSize,
      dto.limit ?? config.pagination.defaultPageSize
    );

    let assignedToVendorUserId: bigint | undefined;
    if (dto.role === 'staff') {
      // A staff member may only ever see their own assigned lists; reject an
      // attempt to query another staff member's lists.
      if (dto.staffId !== undefined && dto.staffId !== dto.callerStaffId) {
        throw new ForbiddenError('You can only view your own assigned lists');
      }
      assignedToVendorUserId = dto.callerStaffId;
    } else if (dto.staffId !== undefined) {
      assignedToVendorUserId = dto.staffId;
    }

    const isActive = dto.status === 'active' ? true : dto.status === 'archived' ? false : undefined;

    const { rows, total } = await this.repository.list(dto.vendorId, {
      ...(isActive !== undefined ? { isActive } : {}),
      ...(assignedToVendorUserId !== undefined ? { assignedToVendorUserId } : {}),
      skip: (page - 1) * limit,
      take: limit,
    });

    const ids = rows.map((r) => r.id);
    const [assignedStaffMap, customerCountMap] = await Promise.all([
      this.repository.assignedStaffFor(ids),
      this.repository.countActiveCustomers(ids),
    ]);

    const today = new Date();
    const data = await Promise.all(
      rows.map(async (record) => {
        const entity = SupplyListMapper.toDomain(record);
        const todayStats = await this.deliveryStats.getTodayStats(record.id, today);
        return SupplyListMapper.toListResponse(entity, {
          assignedStaff: assignedStaffMap.get(record.id.toString()) ?? [],
          customerCount: customerCountMap.get(record.id.toString()) ?? 0,
          todayStats,
          includePhone: false,
        });
      })
    );

    this.logger.info(
      { vendorId: dto.vendorId.toString(), total, role: dto.role },
      'ListSupplyListsService: lists listed'
    );

    return {
      data,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }
}
