/**
 * Unit tests for AuthController.
 * All services are mocked — only controller delegation and response helpers are exercised.
 */

import { Request, Response, NextFunction } from 'express';
import { AuthController } from '../auth.controller';
import { UnauthorizedError } from '@/common/errors/app-error';

// ─── Mock response utilities ───────────────────────────────────────────────────
jest.mock('@/common/api-wrapper/response.util', () => ({
  sendCreated: jest.fn(),
  sendSuccess: jest.fn(),
}));

import { sendCreated, sendSuccess } from '@/common/api-wrapper/response.util';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildReq(body: Record<string, unknown> = {}, extra: Partial<Request> = {}): Request {
  return {
    body,
    ip: '127.0.0.1',
    headers: { 'user-agent': 'jest/test' },
    ...extra,
  } as unknown as Request;
}

function buildRes(): Response {
  return {} as Response;
}

function buildNext(): NextFunction {
  return jest.fn() as NextFunction;
}

// ─── Mock service factory ──────────────────────────────────────────────────────

const mockSignupResult = {
  user: { id: '1', phone: '+919876543210' },
  tokens: { accessToken: 'at', refreshToken: 'rt' },
  vendorContext: { vendorId: '10', vendorName: 'Test Vendor', role: 'vendor_owner' },
};

const mockLoginResult = {
  user: { id: '1', phone: '+919876543210' },
  tokens: { accessToken: 'at', refreshToken: 'rt' },
  vendorContexts: [{ vendorId: '10', vendorName: 'Test Vendor', role: 'vendor_owner' }],
};

function buildController() {
  const signupService = { execute: jest.fn().mockResolvedValue(mockSignupResult) };
  const loginService = { execute: jest.fn().mockResolvedValue(mockLoginResult) };
  const refreshTokenService = {
    execute: jest.fn().mockResolvedValue({ accessToken: 'new-at', refreshToken: 'new-rt' }),
  };
  const forgotPasswordService = {
    execute: jest.fn().mockResolvedValue({ message: 'OTP sent' }),
  };
  const resetPasswordService = {
    execute: jest.fn().mockResolvedValue({ message: 'Password updated' }),
  };
  const logoutService = {
    execute: jest.fn().mockResolvedValue({ message: 'Logged out successfully.' }),
  };

  const controller = new AuthController(
    signupService as never,
    loginService as never,
    refreshTokenService as never,
    forgotPasswordService as never,
    resetPasswordService as never,
    logoutService as never
  );

  return {
    controller,
    signupService,
    loginService,
    refreshTokenService,
    forgotPasswordService,
    resetPasswordService,
    logoutService,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AuthController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ── signup ──────────────────────────────────────────────────────────────────
  describe('signup handler', () => {
    it('delegates to signupService and calls sendCreated', async () => {
      const { controller, signupService } = buildController();
      const req = buildReq({ phone: '+919876543210', password: 'Test@123x', vendorName: 'V' });
      const res = buildRes();
      const next = buildNext();

      await controller.signup(req, res, next);

      expect(signupService.execute).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+919876543210', password: 'Test@123x', vendorName: 'V' })
      );
      expect(sendCreated).toHaveBeenCalledWith(res, mockSignupResult);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next(error) when signupService throws', async () => {
      const { controller, signupService } = buildController();
      const err = new UnauthorizedError('boom');
      signupService.execute.mockRejectedValue(err);

      const req = buildReq({ phone: '+919876543210', password: 'Test@123x', vendorName: 'V' });
      const next = buildNext();

      await controller.signup(req, buildRes(), next);

      expect(next).toHaveBeenCalledWith(err);
      expect(sendCreated).not.toHaveBeenCalled();
    });
  });

  // ── login ───────────────────────────────────────────────────────────────────
  describe('login handler', () => {
    it('delegates to loginService and calls sendSuccess', async () => {
      const { controller, loginService } = buildController();
      const req = buildReq({ phone: '+919876543210', password: 'Test@123x' });
      const res = buildRes();
      const next = buildNext();

      await controller.login(req, res, next);

      expect(loginService.execute).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '+919876543210', password: 'Test@123x' })
      );
      expect(sendSuccess).toHaveBeenCalledWith(res, mockLoginResult);
      expect(next).not.toHaveBeenCalled();
    });

    it('calls next(error) when loginService throws', async () => {
      const { controller, loginService } = buildController();
      const err = new UnauthorizedError('Invalid credentials');
      loginService.execute.mockRejectedValue(err);

      const next = buildNext();
      await controller.login(
        buildReq({ phone: '+919876543210', password: 'wrong' }),
        buildRes(),
        next
      );

      expect(next).toHaveBeenCalledWith(err);
      expect(sendSuccess).not.toHaveBeenCalled();
    });
  });

  // ── refresh ─────────────────────────────────────────────────────────────────
  describe('refresh handler', () => {
    it('delegates to refreshTokenService and calls sendSuccess', async () => {
      const { controller, refreshTokenService } = buildController();
      const req = buildReq({ refreshToken: 'some-refresh-token' });
      const res = buildRes();
      const next = buildNext();

      await controller.refresh(req, res, next);

      expect(refreshTokenService.execute).toHaveBeenCalledWith(
        expect.objectContaining({ refreshToken: 'some-refresh-token' })
      );
      expect(sendSuccess).toHaveBeenCalledWith(res, {
        accessToken: 'new-at',
        refreshToken: 'new-rt',
      });
    });

    it('calls next(error) when refreshTokenService throws', async () => {
      const { controller, refreshTokenService } = buildController();
      const err = new UnauthorizedError('Invalid or revoked refresh token');
      refreshTokenService.execute.mockRejectedValue(err);

      const next = buildNext();
      await controller.refresh(buildReq({ refreshToken: 'bad' }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });

  // ── forgotPassword ──────────────────────────────────────────────────────────
  describe('forgotPassword handler', () => {
    it('delegates to forgotPasswordService and calls sendSuccess', async () => {
      const { controller, forgotPasswordService } = buildController();
      const req = buildReq({ phone: '+919876543210' });
      const res = buildRes();
      const next = buildNext();

      await controller.forgotPassword(req, res, next);

      expect(forgotPasswordService.execute).toHaveBeenCalledWith({ phone: '+919876543210' });
      expect(sendSuccess).toHaveBeenCalledWith(res, { message: 'OTP sent' });
    });

    it('calls next(error) on service throw', async () => {
      const { controller, forgotPasswordService } = buildController();
      const err = new Error('unexpected');
      forgotPasswordService.execute.mockRejectedValue(err);

      const next = buildNext();
      await controller.forgotPassword(buildReq({ phone: '+919876543210' }), buildRes(), next);

      expect(next).toHaveBeenCalledWith(err);
    });
  });
});
