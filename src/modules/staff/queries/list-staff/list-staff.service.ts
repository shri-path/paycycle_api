import { Logger } from '@/infrastructure/logger/logger';
import { QueryBuilder } from '@/common/api-wrapper/query-builder';
import { ListQueryParams } from '@/common/api-wrapper/types';
import { IVendorMembershipRepository } from '../../database/vendor-membership.repository.port';
import { StaffMapper } from '../../database/staff.mapper';
import { ListAssignmentPort } from '../../ports/list-assignment.port';
import { SubscriptionLimitPort } from '../../ports/subscription-limit.port';
import { StaffResponseDto, StaffLimitsDto } from '../../staff.types';

const ALLOWED_FIELDS = ['status', 'areaRouteLabel', 'createdAt', 'joinedAt', 'invitedAt'];

export interface ListStaffRequestDto {
  vendorId: bigint;
  query: ListQueryParams;
}

export interface ListStaffResult {
  data: StaffResponseDto[];
  meta: { page: number; limit: number; total: number; totalPages: number };
  limits: StaffLimitsDto;
}

export class ListStaffService {
  constructor(
    private readonly membershipRepository: IVendorMembershipRepository,
    private readonly listAssignmentPort: ListAssignmentPort,
    private readonly subscriptionLimitPort: SubscriptionLimitPort,
    private readonly logger: Logger
  ) {}

  /** Query: paginated staff list for a vendor (owner-only route). */
  async execute(dto: ListStaffRequestDto): Promise<ListStaffResult> {
    const parsed = QueryBuilder.parseListQuery(dto.query, ALLOWED_FIELDS);
    const page = Math.floor(parsed.skip / parsed.take) + 1;

    const { rows, total } = await this.membershipRepository.listByVendor(dto.vendorId, {
      where: parsed.where,
      orderBy: parsed.orderBy as never,
      skip: parsed.skip,
      take: parsed.take,
    });

    const data = await Promise.all(
      rows.map(async (record) => {
        const entity = StaffMapper.toDomain(record);
        const [assignedListCount, assignedListIds] = await Promise.all([
          this.listAssignmentPort.countAssignedLists(record.id),
          this.listAssignmentPort.getAssignedListIds(record.id),
        ]);
        return StaffMapper.toResponse(entity, record, { assignedListCount, assignedListIds });
      })
    );

    // Subscription staff-limit snapshot (OQ-7 — stub reports unlimited until US-009).
    const [maxStaff, currentActive] = await Promise.all([
      this.subscriptionLimitPort.getStaffLimit(dto.vendorId),
      this.subscriptionLimitPort.getCurrentStaffCount(dto.vendorId),
    ]);
    const limits: StaffLimitsDto = {
      maxStaff,
      currentActive,
      canAddMore: maxStaff === null || currentActive < maxStaff,
    };

    this.logger.info(
      { vendorId: dto.vendorId.toString(), total },
      'ListStaffService: staff listed'
    );

    return {
      data,
      meta: {
        page,
        limit: parsed.take,
        total,
        totalPages: Math.ceil(total / parsed.take),
      },
      limits,
    };
  }
}
