/**
 * Unit tests — CreateVendorReferralCommand.
 * Covers: self-referral block, rate limit, duplicate, lazy code generation.
 */
import { CreateVendorReferralCommand } from '../../commands/create-vendor-referral/create-vendor-referral.command';
import { IReferralRepository } from '../../database/referral.repository.port';
import { REWARD_AMOUNTS, ReferralVendorStatus } from '../../domain/vendor-referral.types';
import { ForbiddenError, TooManyRequestsError, ConflictError } from '@/common/errors/app-error';
import { AuditPort, AuditLogInput } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const referrerVendorId = BigInt(10);

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

function makeReferralRow(overrides: Record<string, unknown> = {}) {
  return {
    id: BigInt(1),
    referrerVendorId,
    refereeVendorId: null,
    referralCode: 'MILK1234',
    status: ReferralVendorStatus.PENDING,
    rewardType: null,
    rewardAmount: 500,
    refereeName: null,
    refereePhone: '+919999999999',
    signupDate: null,
    firstCustomerDate: null,
    milestone10At: null,
    milestone50At: null,
    revenueShareUntil: null,
    clawedBackAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function makeRepo(
  overrides: Partial<jest.Mocked<IReferralRepository>> = {}
): jest.Mocked<IReferralRepository> {
  return {
    countTodayReferrals: jest.fn().mockResolvedValue(0),
    getVendorName: jest.fn().mockResolvedValue('Milk Depot'),
    getVendorPhone: jest.fn().mockResolvedValue('+911111111111'),
    getVendorReferralCode: jest.fn().mockResolvedValue('MILK1234'),
    isReferralCodeUnique: jest.fn().mockResolvedValue(true),
    setVendorReferralCode: jest.fn().mockResolvedValue(undefined),
    findVendorReferralByPhone: jest.fn().mockResolvedValue(null),
    insertVendorReferral: jest.fn().mockResolvedValue(makeReferralRow()),
    // stubs for other methods
    updateVendorReferral: jest.fn(),
    findVendorReferralById: jest.fn(),
    findVendorReferralByCode: jest.fn(),
    listVendorReferrals: jest.fn(),
    findActiveReferralsByReferee: jest.fn(),
    findReferralsForMilestoneSweep: jest.fn(),
    findReferralsForClawbackSweep: jest.fn(),
    findReferralsInRevenueShareWindow: jest.fn(),
    hasRevenueShareForMonth: jest.fn(),
    earnCredit: jest.fn(),
    useCredit: jest.fn(),
    adjustCredit: jest.fn(),
    getVendorCreditBalance: jest.fn(),
    listCreditTransactions: jest.fn(),
    insertCustomerReferral: jest.fn(),
    findCustomerReferralSummary: jest.fn(),
    findTopReferrers: jest.fn(),
    listCustomerReferrals: jest.fn(),
    listRecentCustomerReferrals: jest.fn(),
    insertInvites: jest.fn(),
    findActiveInviteByPhone: jest.fn(),
    findInvitesDueForResend: jest.fn(),
    listInvites: jest.fn(),
    updateInviteStatus: jest.fn(),
    incrementInviteAttempt: jest.fn(),
    findNearbyVendors: jest.fn(),
    listLeaderboard: jest.fn(),
    upsertLeaderboardEntry: jest.fn(),
    getVendorInfo: jest.fn(),
    countVendorCustomers: jest.fn(),
    findVendorNamesByIds: jest.fn(),
    findCustomerNamesByIds: jest.fn(),
    findCustomersForInvite: jest.fn(),
    listCreditTransactionsByReferral: jest.fn(),
    totalEarnedForReferral: jest.fn(),
    transaction: jest.fn(),
    ...overrides,
  } as unknown as jest.Mocked<IReferralRepository>;
}

describe('CreateVendorReferralCommand', () => {
  describe('rate limit', () => {
    it('should throw TooManyRequestsError when daily limit exceeded', async () => {
      const repo = makeRepo({
        countTodayReferrals: jest.fn().mockResolvedValue(REWARD_AMOUNTS.REFERRAL_DAILY_LIMIT),
      });
      const cmd = new CreateVendorReferralCommand(repo, makeAudit(), logger);

      await expect(
        cmd.execute({ referrerVendorId, vendorName: 'Test', refereePhone: '+919999999999' })
      ).rejects.toThrow(TooManyRequestsError);
    });

    it('should throw with clear rate limit message', async () => {
      const repo = makeRepo({
        countTodayReferrals: jest.fn().mockResolvedValue(10),
      });
      const cmd = new CreateVendorReferralCommand(repo, makeAudit(), logger);

      await expect(
        cmd.execute({ referrerVendorId, vendorName: 'Test', refereePhone: '+919999999999' })
      ).rejects.toThrow(/10\/day/);
    });
  });

  describe('duplicate check', () => {
    it('should throw ConflictError if open referral to same phone exists', async () => {
      const repo = makeRepo({
        findVendorReferralByPhone: jest.fn().mockResolvedValue(makeReferralRow()),
      });
      const cmd = new CreateVendorReferralCommand(repo, makeAudit(), logger);

      await expect(
        cmd.execute({ referrerVendorId, vendorName: 'Test', refereePhone: '+919999999999' })
      ).rejects.toThrow(ConflictError);
    });
  });

  describe('self-referral block', () => {
    it('should throw ForbiddenError when referee phone matches referrer phone', async () => {
      // Make the repository return the same phone as the referee's phone
      const repo = makeRepo({
        getVendorPhone: jest.fn().mockResolvedValue('+919999999999'),
      });
      const cmd = new CreateVendorReferralCommand(repo, makeAudit(), logger);

      await expect(
        cmd.execute({ referrerVendorId, vendorName: 'Test', refereePhone: '+919999999999' })
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('successful creation', () => {
    it('should return referralId and referralCode', async () => {
      const repo = makeRepo();
      const cmd = new CreateVendorReferralCommand(repo, makeAudit(), logger);

      const result = await cmd.execute({
        referrerVendorId,
        vendorName: 'Milk Depot',
        refereePhone: '+919999999999',
      });

      expect(result.referralId).toBeDefined();
      expect(result.referralCode).toBe('MILK1234');
      expect(result.referralLink).toContain('MILK1234');
    });

    it('should include a message with the referral code and link', async () => {
      const repo = makeRepo();
      const cmd = new CreateVendorReferralCommand(repo, makeAudit(), logger);

      const result = await cmd.execute({
        referrerVendorId,
        vendorName: 'Milk Depot',
        refereePhone: '+919999999999',
      });

      expect(result.message).toContain('MILK1234');
      expect(result.message).toContain('PayCycle');
    });

    it('should call insertVendorReferral', async () => {
      const repo = makeRepo();
      const cmd = new CreateVendorReferralCommand(repo, makeAudit(), logger);

      await cmd.execute({
        referrerVendorId,
        vendorName: 'Milk Depot',
        refereePhone: '+919999999999',
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(repo.insertVendorReferral).toHaveBeenCalled();
    });

    it('should lazily generate code when vendor has none', async () => {
      const repo = makeRepo({
        getVendorReferralCode: jest.fn().mockResolvedValue(null),
        isReferralCodeUnique: jest.fn().mockResolvedValue(true),
        setVendorReferralCode: jest.fn().mockResolvedValue(undefined),
      });
      const cmd = new CreateVendorReferralCommand(repo, makeAudit(), logger);

      await cmd.execute({
        referrerVendorId,
        vendorName: 'Milk Depot',
        refereePhone: '+919999999999',
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(repo.setVendorReferralCode).toHaveBeenCalled();
    });
  });

  describe('audit trail (US-15.2)', () => {
    it('should emit a REFERRAL_CREATED audit entry with masked referee phone', async () => {
      const repo = makeRepo();
      const audit = makeAudit();
      const cmd = new CreateVendorReferralCommand(repo, audit, logger);

      await cmd.execute({
        referrerVendorId,
        vendorName: 'Milk Depot',
        refereePhone: '+919876543210',
        actorUserId: BigInt(77),
        actorRole: 'vendor_owner',
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(audit.log).toHaveBeenCalledTimes(1);
      const entry = firstAuditEntry(audit);
      expect(entry.action).toBe(AuditAction.REFERRAL_CREATED);
      expect(entry.vendorId).toBe(referrerVendorId);
      expect(entry.performedByUserId).toBe(BigInt(77));
      expect(entry.performedByRole).toBe('vendor_owner');
      expect(entry.entityType).toBe('vendor_referral');
      expect(entry.entityId).toBe(BigInt(1));
      // Phone must be masked — full number never present.
      expect(entry.metadata.refereePhoneMasked).not.toContain('987654');
      expect(entry.metadata.refereePhoneMasked).toMatch(/3210$/);
      expect(entry.metadata.referralCode).toBe('MILK1234');
      expect(entry.correlationId).toBeDefined();
    });

    it('should NOT emit an audit entry when creation is blocked (rate limit)', async () => {
      const repo = makeRepo({
        countTodayReferrals: jest.fn().mockResolvedValue(REWARD_AMOUNTS.REFERRAL_DAILY_LIMIT),
      });
      const audit = makeAudit();
      const cmd = new CreateVendorReferralCommand(repo, audit, logger);

      await expect(
        cmd.execute({ referrerVendorId, vendorName: 'Test', refereePhone: '+919999999999' })
      ).rejects.toThrow(TooManyRequestsError);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('should still return the created referral when the audit port swallows a failure', async () => {
      // The shared AuditLogger never throws into the caller (AuditPort contract):
      // it logs+swallows internally and resolves. So a failed audit write must not
      // affect the already-persisted referral nor the command's return value.
      const repo = makeRepo();
      const audit = makeAudit(); // log resolves (mirrors AuditLogger swallow behaviour)
      const cmd = new CreateVendorReferralCommand(repo, audit, logger);

      const result = await cmd.execute({
        referrerVendorId,
        vendorName: 'Milk Depot',
        refereePhone: '+919876543210',
      });

      expect(result.referralId).toBe('1');
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(repo.insertVendorReferral).toHaveBeenCalled();
    });
  });
});
