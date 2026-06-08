import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '@/common/errors/app-error';
import { jwtUtil } from './utils/jwt.util';

export const authenticateToken = (req: Request, _res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError('Authentication required'));
    return;
  }

  const token = header.slice(7);
  try {
    const payload = jwtUtil.verifyAccessToken(token);
    req.user = {
      userId: BigInt(payload.userId),
      phone: payload.phone,
      vendorIds: payload.vendorIds.map(BigInt),
    };
    next();
  } catch {
    next(new UnauthorizedError('Invalid or expired token'));
  }
};
