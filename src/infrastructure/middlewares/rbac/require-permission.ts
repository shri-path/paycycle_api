import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ForbiddenError } from '@/common/errors/app-error';
import { PermissionKey } from '@/modules/staff/domain/value-objects/permission-key.value-object';
import { PermissionService } from './permission.service';

/**
 * Gate a route on a staff capability. Owners are always allowed.
 * Requires identifyUserRole to have populated req.roleContext.
 *
 * For non-list-scoped capabilities only (the vendor-wide grant check). Routes
 * that need list/customer-scoped checks should call PermissionService directly
 * in their handler with the resolved listId/customerId.
 */
export const requirePermission = (
  permissionService: PermissionService,
  key: PermissionKey
): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = req.roleContext;
    if (!ctx) {
      next(new ForbiddenError('Role context not resolved'));
      return;
    }
    if (!permissionService.hasCapability(ctx, key)) {
      next(new ForbiddenError('You do not have permission to perform this action'));
      return;
    }
    next();
  };
};
