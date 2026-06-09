import { Logger } from '@/infrastructure/logger/logger';
import { NotFoundError } from '@/common/errors/app-error';
import { IVendorMembershipRepository } from '../../database/vendor-membership.repository.port';
import { ListAssignmentWritePort } from '../../ports/list-assignment-write.port';
import { AssignListResponseDto } from '../../staff.types';
import { AssignListRequestDto } from './assign-list.request.dto';

/**
 * Command: assign a staff member to a supply list (gated until US-005).
 * Runs the tenant guard FIRST so the write port's 503 is reachable only by an
 * owner of the tenant — it never leaks staff existence to other callers.
 */
export class AssignListService {
  constructor(
    private readonly membershipRepository: IVendorMembershipRepository,
    private readonly listWritePort: ListAssignmentWritePort,
    private readonly logger: Logger
  ) {}

  async execute(dto: AssignListRequestDto): Promise<AssignListResponseDto> {
    this.logger.info(
      { vendorId: dto.vendorId.toString(), staffId: dto.staffId.toString() },
      'AssignListService: assign attempt'
    );

    const record = await this.membershipRepository.findById(dto.staffId);
    if (!record || record.vendorId !== dto.vendorId || record.deletedAt !== null) {
      this.logger.warn(
        { vendorId: dto.vendorId.toString(), staffId: dto.staffId.toString() },
        'AssignListService: staff not found or tenant mismatch'
      );
      throw new NotFoundError('Staff member not found');
    }

    // Delegates to the Supply List context. The fail-closed stub throws 503 until
    // US-005 swaps in the real adapter; the success path below is then live.
    await this.listWritePort.assign(
      dto.staffId,
      dto.supplyListId,
      dto.isPrimary,
      dto.performedByUserId
    );

    return {
      staffId: dto.staffId.toString(),
      supplyListId: dto.supplyListId.toString(),
      isPrimary: dto.isPrimary,
    };
  }
}
