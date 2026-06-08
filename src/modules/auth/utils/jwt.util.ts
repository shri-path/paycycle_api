import jwt, { SignOptions } from 'jsonwebtoken';
import { config } from '@/infrastructure/config';
import { UnauthorizedError } from '@/common/errors/app-error';

export interface JwtAccessPayload {
  userId: string; // BigInt serialized as string
  phone: string;
  vendorIds: string[]; // BigInt[] serialized as string[]
}

export interface JwtRefreshPayload {
  userId: string;
  sessionId: string; // BigInt session ID serialized as string
}

export const jwtUtil = {
  generateAccessToken(payload: JwtAccessPayload): string {
    // Cast expiresIn to string to satisfy exactOptionalPropertyTypes
    const signOpts = {
      issuer: 'paycycle-api',
      expiresIn: config.jwt.accessExpiry,
    } as SignOptions;
    return jwt.sign(payload as unknown as object, config.jwt.secret, signOpts);
  },

  generateRefreshToken(payload: JwtRefreshPayload): string {
    const signOpts = {
      issuer: 'paycycle-api',
      expiresIn: config.jwt.refreshExpiry,
    } as SignOptions;
    return jwt.sign(payload as unknown as object, config.jwt.secret, signOpts);
  },

  verifyAccessToken(token: string): JwtAccessPayload {
    try {
      const decoded = jwt.verify(token, config.jwt.secret, {
        issuer: 'paycycle-api',
      }) as JwtAccessPayload;
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError('Token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedError('Invalid token');
      }
      throw new UnauthorizedError('Authentication failed');
    }
  },

  verifyRefreshToken(token: string): JwtRefreshPayload {
    try {
      const decoded = jwt.verify(token, config.jwt.secret, {
        issuer: 'paycycle-api',
      }) as JwtRefreshPayload;
      return decoded;
    } catch (error) {
      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedError('Refresh token expired');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedError('Invalid refresh token');
      }
      throw new UnauthorizedError('Token refresh failed');
    }
  },
};
