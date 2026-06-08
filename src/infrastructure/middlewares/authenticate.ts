import { Request, Response, NextFunction } from 'express';
import { UnauthorizedError } from '@/common/errors/app-error';
import { jwtUtil } from '@/modules/auth/utils/jwt.util';

export const authenticate = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedError('No authorization header provided');
    }

    const token = authHeader.slice(7);
    if (!token) {
      throw new UnauthorizedError('No token provided');
    }

    const payload = jwtUtil.verifyAccessToken(token);
    req.user = {
      userId: BigInt(payload.userId),
      phone: payload.phone,
      vendorIds: payload.vendorIds.map(BigInt),
    };
    next();
  } catch (error) {
    next(error);
  }
};

export const optionalAuthenticate = (req: Request, _res: Response, next: NextFunction): void => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      next();
      return;
    }
    const token = authHeader.slice(7);
    if (token) {
      const payload = jwtUtil.verifyAccessToken(token);
      req.user = {
        userId: BigInt(payload.userId),
        phone: payload.phone,
        vendorIds: payload.vendorIds.map(BigInt),
      };
    }
    next();
  } catch {
    next();
  }
};
