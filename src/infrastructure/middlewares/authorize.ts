import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '@/common/errors/app-error';
import { OWNER_ROLE_NAME } from './rbac/role-context';

/**
 * Generic permission gate kept back-compatible with the original
 * `authorize(string[])` signature (US-002 replaces the prior no-op stub).
 *
 * Behaviour:
 *  - 401 if unauthenticated.
 *  - Owners (a `vendor_owner` claim in any vendor) are always allowed.
 *  - Otherwise the caller must hold ALL requested permission keys in at least
 *    one of their JWT vendor claims.
 *
 * For richer, vendor-scoped RBAC prefer the rbac/ middleware
 * (identifyUserRole + requireOwnerRole / requirePermission). This helper
 * exists for simple, non-vendor-scoped routes and legacy callers.
 */
export const authorize = (permissions: string[] = []): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    const vendors = req.user.vendors ?? [];
    const isOwner = vendors.some((v) => v.role === OWNER_ROLE_NAME);
    if (isOwner) {
      next();
      return;
    }

    if (permissions.length === 0) {
      next();
      return;
    }

    const hasAll = vendors.some((v) => permissions.every((p) => v.permissions.includes(p)));
    if (!hasAll) {
      next(new ForbiddenError('You do not have permission to perform this action'));
      return;
    }

    next();
  };
};
