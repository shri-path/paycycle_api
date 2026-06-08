/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-var-requires */
/* eslint-disable @typescript-eslint/no-require-imports */
import { VendorUserStatus } from '@prisma/client';
import { ConflictError, ForbiddenError, NotFoundError } from '@/common/errors/app-error';
import {
  ExpiredInviteError,
  InvalidInviteError,
  SubscriptionLimitError,
} from '../domain/staff.errors';
import { PermissionKey } from '../domain/value-objects/permission-key.value-object';
import { InviteToken } from '../domain/value-objects/invite-token.value-object';
import { InviteStaffService } from '../commands/invite-staff/invite-staff.service';
import { UpdateStaffService } from '../commands/update-staff/update-staff.service';
import { AcceptInviteService } from '../commands/accept-invite/accept-invite.service';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;

// prisma.$transaction runs the callback with a fake tx by default.
jest.mock('@/infrastructure/database/prisma.client', () => ({
  prisma: {
    $transaction: jest.fn((cb: any) => cb({})),
    role: { findFirst: jest.fn() },
  },
}));
jest.mock('@/modules/auth/utils/password.util', () => ({
  passwordUtil: { hash: jest.fn().mockResolvedValue('$2b$10$hash'), compare: jest.fn() },
}));
jest.mock('@/modules/auth/utils/jwt.util', () => ({
  jwtUtil: {
    generateAccessToken: jest.fn().mockReturnValue('access'),
    generateRefreshToken: jest.fn().mockReturnValue('refresh'),
  },
}));
jest.mock('@/modules/auth/auth.mapper', () => ({
  UserMapper: { toDomain: jest.fn((r) => r), toResponse: jest.fn(() => ({ id: '2' })) },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('@/infrastructure/database/prisma.client');

function membershipRecord(overrides: any = {}): any {
  return {
    id: 5n,
    vendorId: 1n,
    userId: 2n,
    roleId: 3n,
    status: VendorUserStatus.ACTIVE,
    phone: '+919000000010',
    areaRouteLabel: null,
    invitedAt: new Date(),
    joinedAt: new Date(),
    disabledAt: null,
    removedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    role: { name: 'vendor_staff' },
    user: { name: 'Asha', phone: '+919000000010' },
    staffPermissions: [],
    ...overrides,
  };
}

describe('InviteStaffService', () => {
  let membershipRepo: any;
  let invitationRepo: any;
  let userRepo: any;
  let subscriptionPort: any;
  let audit: any;
  let service: InviteStaffService;

  beforeEach(() => {
    // resetMocks:true wipes inline factory implementations — restore them here.
    prisma.$transaction.mockImplementation((cb: any) => cb({}));
    prisma.role.findFirst.mockResolvedValue({ id: 3n, name: 'vendor_staff' });
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@/modules/auth/utils/password.util').passwordUtil.hash.mockResolvedValue('$2b$10$h');
    membershipRepo = {
      findByVendorAndPhone: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(membershipRecord({ status: 'INVITED' })),
      insertWithPermissions: jest.fn().mockResolvedValue(membershipRecord({ status: 'INVITED' })),
      update: jest.fn(),
      replacePermissions: jest.fn(),
    };
    invitationRepo = {
      insert: jest.fn().mockResolvedValue({}),
      revokePendingByMembership: jest.fn(),
    };
    userRepo = {
      findByPhone: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue({ id: 2n, phone: '+919000000010' }),
    };
    subscriptionPort = {
      getStaffLimit: jest.fn().mockResolvedValue(null),
      getCurrentStaffCount: jest.fn().mockResolvedValue(0),
    };
    audit = { log: jest.fn() };
    service = new InviteStaffService(
      membershipRepo,
      invitationRepo,
      userRepo,
      subscriptionPort,
      audit,
      logger
    );
  });

  const dto = {
    vendorId: 1n,
    invitedByUserId: 9n,
    invitedByRole: 'vendor_owner',
    phone: '+919000000010',
    name: 'Asha',
    areaRouteLabel: 'Route A',
    permissions: [PermissionKey.MARK_DELIVERIES],
    ip: null,
    userAgent: null,
  };

  it('invites a new staff member and returns an invite URL', async () => {
    const result = await service.execute(dto);
    expect(result.inviteUrl).toContain('accept-invite?token=');
    expect(membershipRepo.insertWithPermissions).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalled();
  });

  it('throws ConflictError (409) when the phone is already an active staff member', async () => {
    membershipRepo.findByVendorAndPhone.mockResolvedValue(membershipRecord({ status: 'ACTIVE' }));
    await expect(service.execute(dto)).rejects.toBeInstanceOf(ConflictError);
  });

  it('reactivates a REMOVED membership instead of erroring (OQ-8)', async () => {
    membershipRepo.findByVendorAndPhone.mockResolvedValue(
      membershipRecord({ status: 'REMOVED', deletedAt: new Date() })
    );
    await service.execute(dto);
    // Must run inside the surrounding $transaction (MAJOR-1): the tx client is
    // forwarded as the third argument so a partial failure rolls the flip back.
    expect(membershipRepo.update).toHaveBeenCalledWith(
      5n,
      expect.objectContaining({ status: 'INVITED' }),
      expect.anything()
    );
    expect(membershipRepo.insertWithPermissions).not.toHaveBeenCalled();
  });

  it('throws SubscriptionLimitError (451) when the staff cap is reached', async () => {
    subscriptionPort.getStaffLimit.mockResolvedValue(2);
    subscriptionPort.getCurrentStaffCount.mockResolvedValue(2);
    await expect(service.execute(dto)).rejects.toBeInstanceOf(SubscriptionLimitError);
  });
});

describe('UpdateStaffService', () => {
  let membershipRepo: any;
  let sessionRevocation: any;
  let audit: any;
  let service: UpdateStaffService;

  beforeEach(() => {
    membershipRepo = {
      findById: jest.fn().mockResolvedValue(membershipRecord()),
      update: jest.fn(),
      replacePermissions: jest.fn(),
    };
    prisma.$transaction.mockImplementation((cb: any) => cb({}));
    sessionRevocation = { revokeAllForUser: jest.fn() };
    audit = { log: jest.fn() };
    service = new UpdateStaffService(membershipRepo, sessionRevocation, audit, logger);
  });

  const base = {
    vendorId: 1n,
    staffId: 5n,
    performedByUserId: 9n,
    performedByRole: 'vendor_owner',
    ip: null,
    userAgent: null,
  };

  it('masks a wrong-vendor staffId as 404', async () => {
    membershipRepo.findById.mockResolvedValue(membershipRecord({ vendorId: 999n }));
    await expect(
      service.execute({ ...base, status: VendorUserStatus.DISABLED })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('refuses to modify the owner membership (403, OQ-6)', async () => {
    membershipRepo.findById.mockResolvedValue(membershipRecord({ role: { name: 'vendor_owner' } }));
    await expect(
      service.execute({ ...base, status: VendorUserStatus.DISABLED })
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('revokes sessions when a staff member is disabled', async () => {
    await service.execute({ ...base, status: VendorUserStatus.DISABLED });
    expect(sessionRevocation.revokeAllForUser).toHaveBeenCalledWith(
      2n,
      'staff_disabled',
      expect.any(String)
    );
  });
});

describe('AcceptInviteService', () => {
  let membershipRepo: any;
  let invitationRepo: any;
  let userRepo: any;
  let sessionRepo: any;
  let vendorUserRepo: any;
  let audit: any;
  let service: AcceptInviteService;

  const rawToken = InviteToken.generate().raw;

  function invRecord(overrides: any = {}): any {
    const created = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 day ago
    return {
      id: 7n,
      vendorId: 1n,
      vendorUserId: 5n,
      invitedByUserId: 9n,
      phone: '+919000000010',
      tokenHash: InviteToken.hash(rawToken),
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
      revokedAt: null,
      createdAt: created,
      updatedAt: created,
      ...overrides,
    };
  }

  beforeEach(() => {
    prisma.$transaction.mockImplementation((cb: any) => cb({}));
    // Restore implementations wiped by resetMocks:true.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { jwtUtil } = require('@/modules/auth/utils/jwt.util');
    jwtUtil.generateAccessToken.mockReturnValue('access');
    jwtUtil.generateRefreshToken.mockReturnValue('refresh');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { passwordUtil } = require('@/modules/auth/utils/password.util');
    passwordUtil.hash.mockResolvedValue('$2b$10$hash');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { UserMapper } = require('@/modules/auth/auth.mapper');
    UserMapper.toDomain.mockImplementation((r: any) => r);
    UserMapper.toResponse.mockReturnValue({ id: '2' });

    invitationRepo = {
      findByTokenHash: jest.fn().mockResolvedValue(invRecord()),
      update: jest.fn(),
    };
    membershipRepo = {
      findById: jest.fn().mockResolvedValue(membershipRecord({ status: 'INVITED' })),
      update: jest.fn(),
    };
    userRepo = {
      update: jest.fn(),
      findById: jest.fn().mockResolvedValue({ id: 2n, phone: '+919000000010' }),
    };
    sessionRepo = { create: jest.fn() };
    vendorUserRepo = {
      findVendorClaimsByUserId: jest
        .fn()
        .mockResolvedValue([{ vendorId: 1n, roleName: 'vendor_staff', permissions: [] }]),
      findActiveContextsByUserId: jest
        .fn()
        .mockResolvedValue([{ vendorId: 1n, roleName: 'vendor_staff', vendorName: 'V' }]),
    };
    audit = { log: jest.fn() };
    service = new AcceptInviteService(
      membershipRepo,
      invitationRepo,
      userRepo,
      sessionRepo,
      vendorUserRepo,
      audit,
      logger
    );
  });

  const dto = { token: rawToken, password: 'Password1', name: 'Asha', ip: null, userAgent: null };

  it('accepts a valid invite and returns tokens (auto-login)', async () => {
    const result = await service.execute(dto);
    expect(result.tokens.accessToken).toBe('access');
    expect(invitationRepo.update).toHaveBeenCalled();
    expect(sessionRepo.create).toHaveBeenCalled();
  });

  it('throws InvalidInviteError (404) for an unknown token', async () => {
    invitationRepo.findByTokenHash.mockResolvedValue(null);
    await expect(service.execute(dto)).rejects.toBeInstanceOf(InvalidInviteError);
  });

  it('throws ExpiredInviteError (422) for an expired token', async () => {
    invitationRepo.findByTokenHash.mockResolvedValue(
      invRecord({ expiresAt: new Date(Date.now() - 1000) })
    );
    await expect(service.execute(dto)).rejects.toBeInstanceOf(ExpiredInviteError);
  });
});
