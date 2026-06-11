import { Logger } from '@/infrastructure/logger/logger';
import { ISupplyListRepository } from '../../database/supply-list.repository.port';
import { buildSupplyListDto } from '../../database/supply-list-projection';
import { SupplyListNotFoundError } from '../../domain/supply-list.errors';
import { DeliveryStatsPort } from '../../ports/delivery-stats.port';
import { SupplyListDto } from '../../supply-list.types';

export interface GetSupplyListRequestDto {
  vendorId: bigint;
  listId: bigint;
  role: 'owner' | 'staff';
  callerStaffId: bigint;
}

export class GetSupplyListService {
  constructor(
    private readonly repository: ISupplyListRepository,
    private readonly deliveryStats: DeliveryStatsPort,
    private readonly logger: Logger
  ) {}

  /**
   * Query: full supply-list detail. Owner OR assigned staff. A staff member not
   * assigned to the list gets a 404 mask (existence is never revealed).
   */
  async execute(dto: GetSupplyListRequestDto): Promise<SupplyListDto> {
    const record = await this.repository.findById(dto.listId, dto.vendorId);
    if (!record) {
      throw new SupplyListNotFoundError();
    }

    if (dto.role === 'staff') {
      const assigned = record.staff.some((s) => s.vendorUserId === dto.callerStaffId);
      if (!assigned) {
        this.logger.warn(
          { vendorId: dto.vendorId.toString(), listId: dto.listId.toString() },
          'GetSupplyListService: staff not assigned (masked as 404)'
        );
        throw new SupplyListNotFoundError();
      }
    }

    return buildSupplyListDto(record, this.repository, this.deliveryStats);
  }
}
