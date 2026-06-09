import crypto from 'crypto';
import { Logger } from '@/infrastructure/logger/logger';
import { prisma, PrismaTransaction } from '@/infrastructure/database/prisma.client';
import {
  AppError,
  ForbiddenError,
  InternalServerError,
  NotFoundError,
} from '@/common/errors/app-error';
import { AuditPort } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import { IVendorMembershipRepository } from '../../database/vendor-membership.repository.port';
import { StaffMapper } from '../../database/staff.mapper';
import { PermissionGrant } from '../../domain/vendor-membership.types';
import {
  PermissionKey,
  PermissionKeyVO,
} from '../../domain/value-objects/permission-key.value-object';
import { UpdatePermissionsResponseDto } from '../../staff.types';
import { UpdatePermissionsRequestDto } from './update-permissions.request.dto';

/**
 * Command: set a staff member's permission grants via a grant-map. Each entry
 * explicitly grants/revokes one key; keys absent from the map keep their current
 * state (merge semantics — distinct from PATCH /staff which replaces).
 */
export class UpdatePermissionsService {
  constructor(
    private readonly membershipRepository: IVendorMembershipRepository,
    private readonly auditLogger: AuditPort,
    private readonly logger: Logger
  ) {}

  async execute(dto: UpdatePermissionsRequestDto): Promise<UpdatePermissionsResponseDto> {
    const correlationId = crypto.randomUUID();

    // 1. Load + multi-tenant guard (mask wrong vendor as 404).
    const record = await this.membershipRepository.findById(dto.staffId);
    if (!record || record.vendorId !== dto.vendorId || record.deletedAt !== null) {
      throw new NotFoundError('Staff member not found');
    }

    const entity = StaffMapper.toDomain(record);

    // 2. Owner self-guard (OQ-6): staff endpoints never act on an owner membership.
    if (entity.isOwner) {
      throw new ForbiddenError('Cannot modify the owner membership');
    }

    // 3. Merge the grant-map onto the current grants (absent keys unchanged).
    const merged = new Map<PermissionKey, boolean>();
    for (const g of entity.getProps().permissions) {
      merged.set(g.key, g.granted);
    }
    for (const override of dto.permissions) {
      merged.set(override.key, override.granted);
    }
    const grants: PermissionGrant[] = Array.from(merged.entries()).map(([key, granted]) => ({
      key,
      granted,
    }));

    try {
      await prisma.$transaction(async (txClient) => {
        const tx = txClient as unknown as PrismaTransaction;
        entity.setPermissions(grants, correlationId);
        await this.membershipRepository.replacePermissions(
          dto.staffId,
          StaffMapper.toGrantInputs(entity),
          tx
        );
      });
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.error(
        { err: error, correlationId },
        'UpdatePermissionsService: transaction failed'
      );
      throw new InternalServerError('Failed to update permissions. Please try again.');
    }

    // 4. Audit.
    await this.auditLogger.log({
      vendorId: dto.vendorId,
      performedByUserId: dto.performedByUserId,
      performedByRole: dto.performedByRole,
      action: AuditAction.STAFF_PERMISSIONS_CHANGED,
      entityType: 'staff',
      entityId: dto.staffId,
      metadata: { permissions: dto.permissions },
      ipAddress: dto.ip,
      userAgent: dto.userAgent,
      correlationId,
    });

    this.logger.info(
      { vendorId: dto.vendorId.toString(), staffId: dto.staffId.toString(), correlationId },
      'UpdatePermissionsService: permissions updated'
    );

    // 5. Return the full 3-key grant state.
    const grantedSet = new Set(entity.grantedPermissions());
    return {
      permissions: PermissionKeyVO.all().map((key) => ({
        key,
        granted: grantedSet.has(key),
      })),
    };
  }
}
