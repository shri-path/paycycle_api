/**
 * Unit tests — EarnCreditCommand.
 * Covers: ledger write inside a transaction, and dashboard cache invalidation
 * for the earning (referrer) vendor on a reward-earned event.
 */
import { EarnCreditCommand } from '../../commands/earn-credit/earn-credit.command';
import { IReferralRepository, CreditTransactionRow } from '../../database/referral.repository.port';
import { IDashboardCachePort } from '../../ports/dashboard-cache.port';
import {
  CreditSourceType,
  CreditTransactionType,
  ReferralRewardKind,
} from '../../domain/vendor-referral.types';
import pino from 'pino';

const logger = pino({ level: 'silent' });
const vendorId = BigInt(7);

const txnRow: CreditTransactionRow = {
  id: BigInt(1),
  vendorId,
  vendorCreditId: BigInt(1),
  transactionType: CreditTransactionType.EARNED,
  rewardKind: ReferralRewardKind.SIGNUP_BONUS,
  amount: 500,
  balanceAfter: 500,
  sourceType: CreditSourceType.VENDOR_REFERRAL,
  sourceId: BigInt(99),
  description: 'Signup bonus',
  createdAt: new Date(),
};

function makeRepo(): jest.Mocked<IReferralRepository> {
  return {
    transaction: jest
      .fn()
      .mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb({})),
    earnCredit: jest.fn().mockResolvedValue(txnRow),
  } as unknown as jest.Mocked<IReferralRepository>;
}

function makeCache(): jest.Mocked<IDashboardCachePort<unknown>> {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    invalidate: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn().mockResolvedValue(undefined),
  };
}

describe('EarnCreditCommand', () => {
  it('earns credit within a transaction and returns the ledger row', async () => {
    const repo = makeRepo();
    const cmd = new EarnCreditCommand(repo, makeCache(), logger);

    const result = await cmd.execute({
      vendorId,
      amount: 500,
      rewardKind: ReferralRewardKind.SIGNUP_BONUS,
      sourceType: CreditSourceType.VENDOR_REFERRAL,
      sourceId: BigInt(99),
    });

    expect(result).toBe(txnRow);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(repo.transaction).toHaveBeenCalledTimes(1);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(repo.earnCredit).toHaveBeenCalledTimes(1);
  });

  it('invalidates the dashboard cache for the earning vendor', async () => {
    const repo = makeRepo();
    const cache = makeCache();
    const cmd = new EarnCreditCommand(repo, cache, logger);

    await cmd.execute({ vendorId, amount: 1000, rewardKind: ReferralRewardKind.MILESTONE_10 });

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(cache.invalidate).toHaveBeenCalledWith(vendorId);
  });
});
