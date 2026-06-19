/**
 * Unit tests — ReferralFacade signup-bonus audit (US-15.2).
 * Verifies the reward-earned audit entry is emitted with a `system` actor when a
 * referred vendor signs up, and that audit/signup errors stay swallowed.
 */
import { ReferralFacade } from '../referral.facade';
import { IReferralRepository } from '../database/referral.repository.port';
import { IDashboardCachePort } from '../ports/dashboard-cache.port';
import { AuditPort, AuditLogInput } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import {
  ReferralVendorStatus,
  ReferralRewardKind,
  REWARD_AMOUNTS,
} from '../domain/vendor-referral.types';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const referrerVendorId = BigInt(10);
const refereeVendorId = BigInt(20);
const referralId = BigInt(5);

function makeAudit(): jest.Mocked<AuditPort> {
  return { log: jest.fn().mockResolvedValue(undefined) };
}

/** First audit entry the port received, with metadata narrowed for assertions. */
function firstAuditEntry(audit: jest.Mocked<AuditPort>): AuditLogInput & {
  metadata: Record<string, unknown>;
} {
  const entry = audit.log.mock.calls[0]?.[0];
  if (!entry) throw new Error('expected audit.log to have been called');
  return { ...entry, metadata: entry.metadata ?? {} };
}

function makeCache(): jest.Mocked<IDashboardCachePort<unknown>> {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
}

function makePendingReferralRow() {
  return {
    id: referralId,
    referrerVendorId,
    refereeVendorId: null,
    referralCode: 'MILK1234',
    status: ReferralVendorStatus.PENDING,
    rewardType: null,
    rewardAmount: null,
    refereeName: null,
    refereePhone: null,
    signupDate: null,
    firstCustomerDate: null,
    milestone10At: null,
    milestone50At: null,
    revenueShareUntil: null,
    clawedBackAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

function makeRepo(
  overrides: Partial<jest.Mocked<IReferralRepository>> = {}
): jest.Mocked<IReferralRepository> {
  return {
    findVendorReferralByCode: jest.fn().mockResolvedValue(makePendingReferralRow()),
    findActiveReferralsByReferee: jest.fn().mockResolvedValue(null),
    updateVendorReferral: jest.fn().mockResolvedValue(undefined),
    earnCredit: jest.fn().mockResolvedValue(undefined),
    transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({});
    }),
    insertCustomerReferral: jest.fn(),
    findActiveInviteByPhone: jest.fn(),
    updateInviteStatus: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<IReferralRepository>;
}

describe('ReferralFacade.processVendorSignup — audit (US-15.2)', () => {
  it('emits a REFERRAL_REWARD_EARNED audit entry with a system actor', async () => {
    const repo = makeRepo();
    const audit = makeAudit();
    const facade = new ReferralFacade(repo, makeCache(), audit, logger);

    await facade.processVendorSignup(refereeVendorId, 'MILK1234');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(audit.log).toHaveBeenCalledTimes(1);
    const entry = firstAuditEntry(audit);
    expect(entry.action).toBe(AuditAction.REFERRAL_REWARD_EARNED);
    expect(entry.vendorId).toBe(referrerVendorId);
    expect(entry.performedByUserId).toBeNull();
    expect(entry.performedByRole).toBe('system');
    expect(entry.entityType).toBe('vendor_referral');
    expect(entry.entityId).toBe(referralId);
    expect(entry.metadata.amount).toBe(REWARD_AMOUNTS.SIGNUP_BONUS);
    expect(entry.metadata.rewardKind).toBe(ReferralRewardKind.SIGNUP_BONUS);
    expect(entry.correlationId).toBeDefined();
  });

  it('does not emit an audit entry when no PENDING referral matches the code', async () => {
    const repo = makeRepo({ findVendorReferralByCode: jest.fn().mockResolvedValue(null) });
    const audit = makeAudit();
    const facade = new ReferralFacade(repo, makeCache(), audit, logger);

    await facade.processVendorSignup(refereeVendorId, 'NOPE0000');

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('swallows audit failures (signup never fails on referral/audit issues)', async () => {
    const repo = makeRepo();
    const audit = makeAudit();
    audit.log.mockRejectedValueOnce(new Error('audit db down'));
    const facade = new ReferralFacade(repo, makeCache(), audit, logger);

    // processVendorSignup wraps everything in try/catch and swallows — must resolve.
    await expect(facade.processVendorSignup(refereeVendorId, 'MILK1234')).resolves.toBeUndefined();
  });
});
