import { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '@/common/errors/app-error';

export const authorize =
  (_permissions: string[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }
    // Simplified authorization for now — RBAC expansion in US-002
    void ForbiddenError; // referenced to satisfy import — remove when US-002 implements real RBAC
    next();
  };
