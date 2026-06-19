/**
 * Unit tests — RedeemCreditCommand.
 * Covers: withdrawal blocked, insufficient credits, successful redemption.
 */
import { RedeemCreditCommand } from '../../commands/redeem-credit/redeem-credit.command';
import { IReferralRepository } from '../../database/referral.repository.port';
import { ISubscriptionCreditPort } from '../../ports/subscription-credit.port';
import { IDashboardCachePort } from '../../ports/dashboard-cache.port';
import { BadRequestError, ConflictError } from '@/common/errors/app-error';
import { CreditSourceType } from '../../domain/vendor-referral.types';
import { AuditPort, AuditLogInput } from '@/common/audit/audit.port';
import { AuditAction } from '@/common/audit/audit-action.enum';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const vendorId = BigInt(1);

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

function makeRepo(availableCredits = 1000): jest.Mocked<IReferralRepository> {
  const balanceRow = {
    id: BigInt(1),
    vendorId,
    availableCredits,
    lifetimeCreditsEarned: availableCredits,
    lifetimeCreditsUsed: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    getVendorCreditBalance: jest.fn().mockResolvedValue(balanceRow),
    transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({});
    }),
    useCredit: jest.fn().mockResolvedValue({
      id: BigInt(999),
      balanceAfter: availableCredits - 100,
      amount: 100,
      type: 'USED',
      sourceType: CreditSourceType.SUBSCRIPTION_PAYMENT,
    }),
    // Add other required methods as stubs
    insertVendorReferral: jest.fn(),
    updateVendorReferral: jest.fn(),
    findVendorReferralById: jest.fn(),
    findVendorReferralByCode: jest.fn(),
    findVendorReferralByPhone: jest.fn(),
    listVendorReferrals: jest.fn(),
    countTodayReferrals: jest.fn(),
    findActiveReferralsByReferee: jest.fn(),
    getVendorReferralCode: jest.fn(),
    setVendorReferralCode: jest.fn(),
    getVendorName: jest.fn(),
    isReferralCodeUnique: jest.fn(),
    findReferralsForMilestoneSweep: jest.fn(),
    findReferralsForClawbackSweep: jest.fn(),
    findReferralsInRevenueShareWindow: jest.fn(),
    hasRevenueShareForMonth: jest.fn(),
    earnCredit: jest.fn(),
    adjustCredit: jest.fn(),
    listCreditTransactions: jest.fn(),
    insertCustomerReferral: jest.fn(),
    findCustomerReferralSummary: jest.fn(),
    findTopReferrers: jest.fn(),
    listCustomerReferrals: jest.fn(),
    insertInvites: jest.fn(),
    listInvites: jest.fn(),
    updateInviteStatus: jest.fn(),
    findNearbyVendors: jest.fn(),
    listLeaderboard: jest.fn(),
    upsertLeaderboardEntry: jest.fn(),
  } as unknown as jest.Mocked<IReferralRepository>;
}

function makeSubCreditPort(): jest.Mocked<ISubscriptionCreditPort> {
  return {
    applyCreditToNextInvoice: jest.fn().mockResolvedValue(undefined),
    applyCreditToUpgrade: jest.fn().mockResolvedValue(undefined),
  };
}

describe('RedeemCreditCommand', () => {
  describe('withdrawal blocked', () => {
    it('should throw BadRequestError when redemptionType is "withdraw"', async () => {
      const repo = makeRepo();
      const subPort = makeSubCreditPort();
      const cmd = new RedeemCreditCommand(repo, subPort, makeCache(), makeAudit(), logger);

      await expect(
        cmd.execute({ vendorId, redemptionType: 'withdraw', amount: 500 })
      ).rejects.toThrow(BadRequestError);
    });

    it('should include clear message about withdrawal being unavailable', async () => {
      const repo = makeRepo();
      const subPort = makeSubCreditPort();
      const cmd = new RedeemCreditCommand(repo, subPort, makeCache(), makeAudit(), logger);

      await expect(
        cmd.execute({ vendorId, redemptionType: 'withdraw', amount: 500 })
      ).rejects.toThrow(/Cash withdrawal is not available in this version/);
    });

    it('should NOT call repository on withdrawal attempt', async () => {
      const repo = makeRepo();
      const subPort = makeSubCreditPort();
      const cmd = new RedeemCreditCommand(repo, subPort, makeCache(), makeAudit(), logger);

      await expect(
        cmd.execute({ vendorId, redemptionType: 'withdraw', amount: 500 })
      ).rejects.toThrow(BadRequestError);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(repo.getVendorCreditBalance).not.toHaveBeenCalled();
    });
  });

  describe('insufficient credits', () => {
    it('should throw ConflictError when amount exceeds available credits', async () => {
      const repo = makeRepo(100); // only 100 available
      const subPort = makeSubCreditPort();
      const cmd = new RedeemCreditCommand(repo, subPort, makeCache(), makeAudit(), logger);

      await expect(
        cmd.execute({ vendorId, redemptionType: 'subscription', amount: 500 })
      ).rejects.toThrow(ConflictError);
    });

    it('should include available and requested amounts in error', async () => {
      const repo = makeRepo(100);
      const subPort = makeSubCreditPort();
      const cmd = new RedeemCreditCommand(repo, subPort, makeCache(), makeAudit(), logger);

      await expect(
        cmd.execute({ vendorId, redemptionType: 'subscription', amount: 500 })
      ).rejects.toThrow(/Available.*100.*Requested.*500/);
    });
  });

  describe('successful redemption', () => {
    it('should return APPLIED status for subscription', async () => {
      const repo = makeRepo(1000);
      const subPort = makeSubCreditPort();
      const cmd = new RedeemCreditCommand(repo, subPort, makeCache(), makeAudit(), logger);

      const result = await cmd.execute({ vendorId, redemptionType: 'subscription', amount: 100 });

      expect(result.status).toBe('APPLIED');
      expect(result.redemptionType).toBe('subscription');
      expect(result.amountApplied).toBe(100);
      expect(result.feeCharged).toBe(0); // no fee in v1
    });

    it('should call applyCreditToNextInvoice for subscription type', async () => {
      const repo = makeRepo(1000);
      const subPort = makeSubCreditPort();
      const cmd = new RedeemCreditCommand(repo, subPort, makeCache(), makeAudit(), logger);

      await cmd.execute({ vendorId, redemptionType: 'subscription', amount: 100 });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(subPort.applyCreditToNextInvoice).toHaveBeenCalledWith(vendorId, 100);
    });

    it('should call applyCreditToUpgrade for upgrade type', async () => {
      const repo = makeRepo(1000);
      const subPort = makeSubCreditPort();
      const cmd = new RedeemCreditCommand(repo, subPort, makeCache(), makeAudit(), logger);

      await cmd.execute({ vendorId, redemptionType: 'upgrade', amount: 200 });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(subPort.applyCreditToUpgrade).toHaveBeenCalledWith(vendorId, 200);
    });

    it('should call transaction and useCredit', async () => {
      const repo = makeRepo(1000);
      const subPort = makeSubCreditPort();
      const cmd = new RedeemCreditCommand(repo, subPort, makeCache(), makeAudit(), logger);

      await cmd.execute({ vendorId, redemptionType: 'subscription', amount: 100 });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(repo.transaction).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(repo.useCredit).toHaveBeenCalled();
    });

    it('should invalidate the dashboard cache for the vendor after redeeming', async () => {
      const repo = makeRepo(1000);
      const subPort = makeSubCreditPort();
      const cache = makeCache();
      const cmd = new RedeemCreditCommand(repo, subPort, cache, makeAudit(), logger);

      await cmd.execute({ vendorId, redemptionType: 'subscription', amount: 100 });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(cache.invalidate).toHaveBeenCalledWith(vendorId);
    });

    it('should NOT invalidate the cache when the redemption fails (insufficient credits)', async () => {
      const repo = makeRepo(50);
      const subPort = makeSubCreditPort();
      const cache = makeCache();
      const cmd = new RedeemCreditCommand(repo, subPort, cache, makeAudit(), logger);

      await expect(
        cmd.execute({ vendorId, redemptionType: 'subscription', amount: 100 })
      ).rejects.toThrow(ConflictError);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(cache.invalidate).not.toHaveBeenCalled();
    });
  });

  describe('audit trail (US-15.2)', () => {
    it('should emit one REFERRAL_CREDIT_REDEEMED audit entry with amount, type and balanceAfter', async () => {
      const repo = makeRepo(1000);
      const subPort = makeSubCreditPort();
      const audit = makeAudit();
      const cmd = new RedeemCreditCommand(repo, subPort, makeCache(), audit, logger);

      await cmd.execute({
        vendorId,
        redemptionType: 'subscription',
        amount: 100,
        actorUserId: BigInt(42),
        actorRole: 'vendor_owner',
      });

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(audit.log).toHaveBeenCalledTimes(1);
      const entry = firstAuditEntry(audit);
      expect(entry.action).toBe(AuditAction.REFERRAL_CREDIT_REDEEMED);
      expect(entry.vendorId).toBe(vendorId);
      expect(entry.performedByUserId).toBe(BigInt(42));
      expect(entry.performedByRole).toBe('vendor_owner');
      expect(entry.metadata.amount).toBe(100);
      expect(entry.metadata.redemptionType).toBe('subscription');
      expect(entry.metadata.balanceAfter).toBe(900);
      expect(entry.correlationId).toBeDefined();
    });

    it('should NOT emit an audit entry when redemption fails (insufficient credits)', async () => {
      const repo = makeRepo(50);
      const subPort = makeSubCreditPort();
      const audit = makeAudit();
      const cmd = new RedeemCreditCommand(repo, subPort, makeCache(), audit, logger);

      await expect(
        cmd.execute({ vendorId, redemptionType: 'subscription', amount: 100 })
      ).rejects.toThrow(ConflictError);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('should NOT emit an audit entry when withdrawal is blocked', async () => {
      const repo = makeRepo(1000);
      const subPort = makeSubCreditPort();
      const audit = makeAudit();
      const cmd = new RedeemCreditCommand(repo, subPort, makeCache(), audit, logger);

      await expect(
        cmd.execute({ vendorId, redemptionType: 'withdraw', amount: 100 })
      ).rejects.toThrow(BadRequestError);

      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(audit.log).not.toHaveBeenCalled();
    });

    it('should default the actor to system when no actorUserId is supplied', async () => {
      const repo = makeRepo(1000);
      const subPort = makeSubCreditPort();
      const audit = makeAudit();
      const cmd = new RedeemCreditCommand(repo, subPort, makeCache(), audit, logger);

      await cmd.execute({ vendorId, redemptionType: 'subscription', amount: 100 });

      const entry = firstAuditEntry(audit);
      expect(entry.performedByUserId).toBeNull();
      expect(entry.performedByRole).toBe('system');
    });
  });
});
