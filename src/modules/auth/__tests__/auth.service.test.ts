/**
 * Unit tests for auth command services.
 * All external dependencies (repositories, logger, utils) are mocked.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */

import { ConflictError, NotFoundError, UnauthorizedError } from '@/common/errors/app-error';
import { SignupService } from '../commands/signup/signup.service';
import { LoginService } from '../commands/login/login.service';
import { IUserRepository } from '../database/user.repository.port';
import { IVendorRepository } from '../database/vendor.repository.port';
import { SessionRepository, VendorUserRepository } from '../database/session.repository';

// ─── Shared mock logger ──────────────────────────────────────────────────────
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

// A valid 60-char bcrypt hash shape
const MOCK_HASH = '$2b$10$abcdefghijklmnopqrstuvuVabcdefghijklmnopqrstuvu1234567890';

/** Build a minimal Prisma User record shape */
function buildUserRecord(
  overrides: Partial<{
    id: bigint;
    phone: string;
    passwordHash: string;
    deletedAt: Date | null;
  }> = {}
) {
  return {
    id: 1n,
    phone: '+919876543210',
    passwordHash: overrides.passwordHash ?? MOCK_HASH,
    name: null,
    email: null,
    profilePhotoUrl: null,
    preferredLanguage: 'en',
    lastLoginAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    deletedAt: overrides.deletedAt ?? null,
    ...overrides,
  };
}

function buildVendorRecord() {
  return {
    id: 10n,
    name: 'Test Vendor',
    phone: null,
    category: null,
    referralCode: null,
    referredByVendorId: null,
    autoMarkEnabled: true,
    autoSendBills: false,
    autoSendTime: '20:00',
    upiId: null,
    bankDetails: null,
    deletedAt: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
}

// ─── Module mocks (hoisted by Jest, implementations set in beforeEach) ────────

jest.mock('@/infrastructure/database/prisma.client', () => ({
  prisma: {
    $transaction: jest.fn(),
  },
}));

jest.mock('../utils/password.util', () => ({
  passwordUtil: {
    hash: jest.fn(),
    compare: jest.fn(),
  },
}));

jest.mock('../utils/jwt.util', () => ({
  jwtUtil: {
    generateAccessToken: jest.fn(),
    generateRefreshToken: jest.fn(),
    verifyRefreshToken: jest.fn(),
  },
}));

import { passwordUtil } from '../utils/password.util';
import { jwtUtil } from '../utils/jwt.util';

// Helper to wire the default prisma.$transaction behaviour (executes callback with a fake tx)
function setupDefaultTransaction(): void {
  /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
  jest
    .requireMock('@/infrastructure/database/prisma.client')
    .prisma.$transaction.mockImplementation((callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        role: {
          findFirst: jest.fn().mockResolvedValue({ id: 1n, name: 'vendor_owner' }),
        },
        vendorUser: {
          create: jest.fn().mockResolvedValue({}),
        },
      })
    );
  /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
}

// ─── SignupService ─────────────────────────────────────────────────────────────

describe('SignupService', () => {
  let userRepository: jest.Mocked<IUserRepository>;
  let vendorRepository: jest.Mocked<IVendorRepository>;
  let sessionRepository: jest.Mocked<SessionRepository>;
  let signupService: SignupService;

  const validDto = {
    phone: '+919876543210',
    password: 'Test@123x',
    vendorName: 'Test Vendor',
    ip: '127.0.0.1',
    userAgent: 'jest/test',
  };

  beforeEach(() => {
    // Re-apply implementations after resetMocks resets them
    (passwordUtil.hash as jest.Mock).mockResolvedValue(MOCK_HASH);
    (jwtUtil.generateAccessToken as jest.Mock).mockReturnValue('mock-access-token');
    (jwtUtil.generateRefreshToken as jest.Mock).mockReturnValue('mock-refresh-token');
    setupDefaultTransaction();

    userRepository = {
      findByPhone: jest.fn(),
      findById: jest.fn(),
      insert: jest.fn().mockResolvedValue(buildUserRecord()),
      update: jest.fn(),
    } as jest.Mocked<IUserRepository>;

    vendorRepository = {
      insert: jest.fn().mockResolvedValue(buildVendorRecord()),
      findById: jest.fn(),
    } as jest.Mocked<IVendorRepository>;

    sessionRepository = {
      create: jest.fn().mockResolvedValue({ id: 100n }),
      findByRefreshToken: jest.fn(),
      revoke: jest.fn(),
      revokeAll: jest.fn(),
    } as unknown as jest.Mocked<SessionRepository>;

    signupService = new SignupService(
      userRepository,
      vendorRepository,
      sessionRepository,
      mockLogger as never
    );
  });

  describe('execute()', () => {
    it('success: returns SignupResponseDto with user, tokens, and vendorContext', async () => {
      const result = await signupService.execute(validDto);

      expect(result).toMatchObject({
        user: expect.objectContaining({
          id: expect.any(String),
          phone: '+919876543210',
        }),
        tokens: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        },
        vendorContext: expect.objectContaining({
          vendorId: expect.any(String),
          vendorName: 'Test Vendor',
          role: 'vendor_owner',
        }),
      });
    });

    it('success: user.passwordHash is NOT in response', async () => {
      const result = await signupService.execute(validDto);
      expect((result.user as Record<string, unknown>)['passwordHash']).toBeUndefined();
      expect((result.user as Record<string, unknown>)['deletedAt']).toBeUndefined();
    });

    it('ConflictError: duplicate phone propagates from repository', async () => {
      userRepository.insert.mockRejectedValue(new ConflictError('Phone already registered'));
      await expect(signupService.execute(validDto)).rejects.toThrow(ConflictError);
    });

    it('NotFoundError: missing vendor_owner role propagates', async () => {
      // Override transaction mock to simulate missing vendor_owner role
      /* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
      jest
        .requireMock('@/infrastructure/database/prisma.client')
        .prisma.$transaction.mockImplementationOnce((callback: (tx: unknown) => Promise<unknown>) =>
          callback({
            role: { findFirst: jest.fn().mockResolvedValue(null) },
            vendorUser: { create: jest.fn() },
          })
        );
      /* eslint-enable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */

      await expect(signupService.execute(validDto)).rejects.toThrow(NotFoundError);
    });
  });
});

// ─── LoginService ──────────────────────────────────────────────────────────────

describe('LoginService', () => {
  let userRepository: jest.Mocked<IUserRepository>;
  let sessionRepository: jest.Mocked<SessionRepository>;
  let vendorUserRepository: jest.Mocked<VendorUserRepository>;
  let loginService: LoginService;

  const validDto = {
    phone: '+919876543210',
    password: 'Test@123x',
    ip: '127.0.0.1',
    userAgent: 'jest/test',
    deviceId: null,
  };

  beforeEach(() => {
    (jwtUtil.generateAccessToken as jest.Mock).mockReturnValue('mock-access-token');
    (jwtUtil.generateRefreshToken as jest.Mock).mockReturnValue('mock-refresh-token');

    userRepository = {
      findByPhone: jest.fn().mockResolvedValue(buildUserRecord()),
      findById: jest.fn(),
      insert: jest.fn(),
      update: jest.fn().mockResolvedValue(buildUserRecord()),
    } as jest.Mocked<IUserRepository>;

    sessionRepository = {
      create: jest.fn().mockResolvedValue({ id: 200n }),
      findByRefreshToken: jest.fn(),
      revoke: jest.fn(),
      revokeAll: jest.fn(),
    } as unknown as jest.Mocked<SessionRepository>;

    vendorUserRepository = {
      findActiveContextsByUserId: jest
        .fn()
        .mockResolvedValue([
          { vendorId: 10n, roleName: 'vendor_owner', vendorName: 'Test Vendor' },
        ]),
    } as jest.Mocked<VendorUserRepository>;

    loginService = new LoginService(
      userRepository,
      sessionRepository,
      vendorUserRepository,
      mockLogger as never
    );
  });

  describe('execute()', () => {
    it('success: returns LoginResponseDto with user, tokens, and vendorContexts array', async () => {
      (passwordUtil.compare as jest.Mock).mockResolvedValue(true);

      const result = await loginService.execute(validDto);

      expect(result).toMatchObject({
        user: expect.objectContaining({ phone: '+919876543210' }),
        tokens: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
        },
        vendorContexts: [expect.objectContaining({ vendorId: '10', role: 'vendor_owner' })],
      });
    });

    it('phone not found: throws UnauthorizedError("Invalid credentials")', async () => {
      userRepository.findByPhone.mockResolvedValue(null);
      (passwordUtil.compare as jest.Mock).mockResolvedValue(false);

      await expect(loginService.execute(validDto)).rejects.toThrow(
        new UnauthorizedError('Invalid credentials')
      );
    });

    it('deleted user: throws UnauthorizedError("Invalid credentials")', async () => {
      userRepository.findByPhone.mockResolvedValue(buildUserRecord({ deletedAt: new Date() }));

      await expect(loginService.execute(validDto)).rejects.toThrow(
        new UnauthorizedError('Invalid credentials')
      );
    });

    it('wrong password: throws UnauthorizedError("Invalid credentials")', async () => {
      (passwordUtil.compare as jest.Mock).mockResolvedValue(false);

      await expect(loginService.execute(validDto)).rejects.toThrow(
        new UnauthorizedError('Invalid credentials')
      );
    });

    it('enumeration prevention: phone-not-found and wrong-password yield same error message', async () => {
      let phoneNotFoundMessage = '';
      let wrongPasswordMessage = '';

      userRepository.findByPhone.mockResolvedValue(null);
      try {
        await loginService.execute(validDto);
      } catch (e) {
        phoneNotFoundMessage = (e as Error).message;
      }

      userRepository.findByPhone.mockResolvedValue(buildUserRecord());
      (passwordUtil.compare as jest.Mock).mockResolvedValue(false);
      try {
        await loginService.execute(validDto);
      } catch (e) {
        wrongPasswordMessage = (e as Error).message;
      }

      expect(phoneNotFoundMessage).toBe(wrongPasswordMessage);
      expect(phoneNotFoundMessage).toBe('Invalid credentials');
    });
  });
});
