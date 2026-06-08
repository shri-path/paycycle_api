import { Request, Response, NextFunction, RequestHandler } from 'express';
import { VendorUserStatus } from '@prisma/client';
import { prisma } from '@/infrastructure/database/prisma.client';
import { NotFoundError, UnauthorizedError } from '@/common/errors/app-error';
import { logger } from '@/infrastructure/logger/logger';
import {
  PermissionKey,
  PermissionKeyVO,
} from '@/modules/staff/domain/value-objects/permission-key.value-object';

export const OWNER_ROLE_NAME = 'vendor_owner';

export type RoleLabel = 'owner' | 'staff';

export interface RoleContext {
  role: RoleLabel;
  roleName: string; // raw slug
  vendorId: bigint;
  userId: bigint;
  staffId: bigint; // the vendor_users.id of the membership
  permissions: PermissionKey[];
}

function toLabel(roleName: string): RoleLabel {
  return roleName === OWNER_ROLE_NAME ? 'owner' : 'staff';
}

/**
 * identifyUserRole(:vendorId) — resolves the caller's RoleContext for the
 * route's :vendorId and attaches it to req.roleContext.
 *
 * OQ-2: reads role/permissions from the JWT claim when present, but ALWAYS
 * re-validates status=ACTIVE against the DB (cheap, indexed) so a disabled or
 * removed staff member is blocked on their next request.
 *
 * Multi-tenant: a vendorId the caller has no ACTIVE membership in → 404 mask
 * (never 403), so existence is never revealed.
 */
export const identifyUserRole = (paramName = 'vendorId'): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    void resolve(req, paramName)
      .then(() => next())
      .catch((err: unknown) => next(err));
  };
};

async function resolve(req: Request, paramName: string): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError('Authentication required');
  }

  const raw = (req.params as Record<string, string>)[paramName];
  if (!raw || !/^\d+$/.test(raw)) {
    throw new NotFoundError('Vendor not found');
  }
  const vendorId = BigInt(raw);

  // DB re-check of membership + status (authoritative — OQ-2).
  const membership = await prisma.vendorUser.findFirst({
    where: { vendorId, userId: req.user.userId, deletedAt: null },
    include: {
      role: { select: { name: true } },
      staffPermissions: { where: { granted: true }, select: { permissionKey: true } },
    },
  });

  if (!membership || membership.status !== VendorUserStatus.ACTIVE) {
    logger.warn(
      {
        vendorId: vendorId.toString(),
        userId: req.user.userId.toString(),
        status: membership?.status,
      },
      'identifyUserRole: no active membership in vendor (masked as 404)'
    );
    throw new NotFoundError('Vendor not found');
  }

  const permissions = membership.staffPermissions
    .map((p) => p.permissionKey)
    .filter((k): k is PermissionKey => PermissionKeyVO.isValid(k))
    .map((k) => PermissionKeyVO.from(k));

  req.roleContext = {
    role: toLabel(membership.role.name),
    roleName: membership.role.name,
    vendorId,
    userId: req.user.userId,
    staffId: membership.id,
    permissions,
  };
}
