import { Request, Response, NextFunction, RequestHandler } from 'express';
import { ForbiddenError } from '@/common/errors/app-error';

/**
 * Gate a route to owner-role callers only. Requires identifyUserRole to have
 * run first (populates req.roleContext). Staff → 403.
 */
export const requireOwnerRole = (): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const ctx = req.roleContext;
    if (!ctx) {
      next(new ForbiddenError('Role context not resolved'));
      return;
    }
    if (ctx.role !== 'owner') {
      next(new ForbiddenError('This action requires owner privileges'));
      return;
    }
    next();
  };
};
