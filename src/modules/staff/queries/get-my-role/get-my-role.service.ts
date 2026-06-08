import { Logger } from '@/infrastructure/logger/logger';
import { NotFoundError } from '@/common/errors/app-error';
import { IVendorMembershipRepository } from '../../database/vendor-membership.repository.port';
import { StaffMapper } from '../../database/staff.mapper';
import { RoleContextDto } from '../../staff.types';

export interface GetMyRoleRequestDto {
  vendorId: bigint;
  userId: bigint;
}

export class GetMyRoleService {
  constructor(
    private readonly membershipRepository: IVendorMembershipRepository,
    private readonly logger: Logger
  ) {}

  /**
   * Query: resolve the caller's role + permissions in a vendor (frontend role
   * detection). Caller must hold a non-removed membership; else 404 (mask).
   */
  async execute(dto: GetMyRoleRequestDto): Promise<RoleContextDto> {
    const record = await this.membershipRepository.findByVendorAndUser(dto.vendorId, dto.userId);
    if (!record || record.deletedAt !== null) {
      throw new NotFoundError('Membership not found for this vendor');
    }

    const entity = StaffMapper.toDomain(record);

    this.logger.info(
      { vendorId: dto.vendorId.toString(), userId: dto.userId.toString() },
      'GetMyRoleService: role resolved'
    );

    return StaffMapper.toRoleContext(entity);
  }
}
