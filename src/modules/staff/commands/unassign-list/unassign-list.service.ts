import { Logger } from '@/infrastructure/logger/logger';
import { NotFoundError } from '@/common/errors/app-error';
import { IVendorMembershipRepository } from '../../database/vendor-membership.repository.port';
import { ListAssignmentWritePort } from '../../ports/list-assignment-write.port';
import { UnassignListResponseDto } from '../../staff.types';

export interface UnassignListRequestDto {
  vendorId: bigint;
  staffId: bigint;
  listId: bigint;
}

/**
 * Command: remove a staff member's assignment to a supply list (gated until US-005).
 * Tenant guard runs first so the write port's 503 is owner-only.
 */
export class UnassignListService {
  constructor(
    private readonly membershipRepository: IVendorMembershipRepository,
    private readonly listWritePort: ListAssignmentWritePort,
    private readonly logger: Logger
  ) {}

  async execute(dto: UnassignListRequestDto): Promise<UnassignListResponseDto> {
    this.logger.info(
      { vendorId: dto.vendorId.toString(), staffId: dto.staffId.toString() },
      'UnassignListService: unassign attempt'
    );

    const record = await this.membershipRepository.findById(dto.staffId);
    if (!record || record.vendorId !== dto.vendorId || record.deletedAt !== null) {
      this.logger.warn(
        { vendorId: dto.vendorId.toString(), staffId: dto.staffId.toString() },
        'UnassignListService: staff not found or tenant mismatch'
      );
      throw new NotFoundError('Staff member not found');
    }

    await this.listWritePort.unassign(dto.staffId, dto.listId);

    return {
      staffId: dto.staffId.toString(),
      listId: dto.listId.toString(),
      unassigned: true,
    };
  }
}
