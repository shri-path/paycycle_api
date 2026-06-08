import { Logger } from '@/infrastructure/logger/logger';
import { NotFoundError } from '@/common/errors/app-error';
import { IVendorMembershipRepository } from '../../database/vendor-membership.repository.port';
import { StaffMapper } from '../../database/staff.mapper';
import { ListAssignmentPort } from '../../ports/list-assignment.port';
import { StaffResponseDto } from '../../staff.types';

export interface GetStaffRequestDto {
  vendorId: bigint;
  staffId: bigint;
}

export class GetStaffService {
  constructor(
    private readonly membershipRepository: IVendorMembershipRepository,
    private readonly listAssignmentPort: ListAssignmentPort,
    private readonly logger: Logger
  ) {}

  /** Query: single staff detail (owner-only). Wrong-tenant masked as 404. */
  async execute(dto: GetStaffRequestDto): Promise<StaffResponseDto> {
    const record = await this.membershipRepository.findById(dto.staffId);
    if (!record || record.vendorId !== dto.vendorId || record.deletedAt !== null) {
      throw new NotFoundError('Staff member not found');
    }

    const entity = StaffMapper.toDomain(record);
    const [assignedListCount, assignedListIds] = await Promise.all([
      this.listAssignmentPort.countAssignedLists(record.id),
      this.listAssignmentPort.getAssignedListIds(record.id),
    ]);

    this.logger.info(
      { vendorId: dto.vendorId.toString(), staffId: dto.staffId.toString() },
      'GetStaffService: staff fetched'
    );

    return StaffMapper.toResponse(entity, record, { assignedListCount, assignedListIds });
  }
}
