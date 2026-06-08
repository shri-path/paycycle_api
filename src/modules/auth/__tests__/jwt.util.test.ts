import { jwtUtil } from '../utils/jwt.util';
import { UnauthorizedError } from '@/common/errors/app-error';
import jwt from 'jsonwebtoken';

describe('JwtUtil', () => {
  const accessPayload = {
    userId: '123',
    phone: '+919876543210',
    vendorIds: ['1', '2'],
  };

  const refreshPayload = {
    userId: '123',
    sessionId: 'session-uuid',
  };

  describe('generateAccessToken / verifyAccessToken', () => {
    it('round-trip: generate and verify access token', () => {
      const token = jwtUtil.generateAccessToken(accessPayload);
      const decoded = jwtUtil.verifyAccessToken(token);
      expect(decoded.userId).toBe(accessPayload.userId);
      expect(decoded.phone).toBe(accessPayload.phone);
      expect(decoded.vendorIds).toEqual(accessPayload.vendorIds);
    });

    it('throws UnauthorizedError for expired access token', () => {
      const token = jwt.sign(
        { userId: '123', phone: '+91', vendorIds: [] },
        process.env['JWT_SECRET'] ?? 'test-jwt-secret-key-minimum-32-characters-long',
        { expiresIn: '0s', issuer: 'paycycle-api' }
      );
      expect(() => jwtUtil.verifyAccessToken(token)).toThrow(UnauthorizedError);
    });

    it('throws UnauthorizedError for wrong secret', () => {
      const token = jwt.sign(accessPayload, 'wrong-secret-that-is-at-least-32-chars-long');
      expect(() => jwtUtil.verifyAccessToken(token)).toThrow(UnauthorizedError);
    });
  });

  describe('generateRefreshToken / verifyRefreshToken', () => {
    it('round-trip: generate and verify refresh token', () => {
      const token = jwtUtil.generateRefreshToken(refreshPayload);
      const decoded = jwtUtil.verifyRefreshToken(token);
      expect(decoded.userId).toBe(refreshPayload.userId);
      expect(decoded.sessionId).toBe(refreshPayload.sessionId);
    });

    it('throws UnauthorizedError for invalid refresh token', () => {
      expect(() => jwtUtil.verifyRefreshToken('not.a.token')).toThrow(UnauthorizedError);
    });
  });
});
