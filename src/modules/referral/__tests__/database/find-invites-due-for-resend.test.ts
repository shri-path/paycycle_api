/**
 * Unit tests — ReferralRepository.findInvitesDueForResendBatch (US-15.4).
 *
 * Verifies the bounded due-for-resend SELECT used by InviteResendSweep without a
 * live DB by mocking the prisma client:
 *   - pushes down status (SENT/DELIVERED only → excludes SIGNED_UP/FAILED),
 *     autoResend, the 7-day lastAttemptAt window, and soft-delete
 *   - orders oldest-first and caps at the requested limit (bounded scan)
 *   - drops rows already at/over max_attempts in memory (anti-spam guard that
 *     Prisma cannot express as a column-to-column comparison)
 */
interface FindManyArg {
  where: Record<string, unknown>;
  orderBy: unknown;
  take: number;
}
const findMany = jest.fn<Promise<Record<string, unknown>[]>, [FindManyArg]>();

jest.mock('@/infrastructure/database/prisma.client', () => ({
  prisma: { referralCustomerInvite: { findMany: (arg: FindManyArg) => findMany(arg) } },
}));

import { ReferralRepository } from '../../database/referral.repository';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const old = new Date('2026-01-01T00:00:00.000Z');
  return {
    id: BigInt(1),
    vendorId: BigInt(10),
    customerId: BigInt(100),
    phone: '9876543210',
    status: 'SENT',
    messageLanguage: 'hi',
    attemptCount: 1,
    autoResend: true,
    maxAttempts: 3,
    sentAt: old,
    lastAttemptAt: old,
    signedUpAt: null,
    createdAt: old,
    updatedAt: old,
    deletedAt: null,
    ...overrides,
  };
}

describe('ReferralRepository.findInvitesDueForResendBatch', () => {
  beforeEach(() => findMany.mockReset());

  it('pushes down the DB-expressible predicates, ordering, and limit', async () => {
    findMany.mockResolvedValue([]);
    const repo = new ReferralRepository();

    await repo.findInvitesDueForResendBatch(100);

    expect(findMany).toHaveBeenCalledTimes(1);
    const arg = findMany.mock.calls[0]?.[0];
    if (!arg) throw new Error('expected findMany to have been called');
    expect(arg.where['autoResend']).toBe(true);
    expect(arg.where['status']).toEqual({ in: ['SENT', 'DELIVERED'] });
    expect(arg.where['deletedAt']).toBeNull();
    // 7-day window: lastAttemptAt <= ~now-7d
    const lastAttempt = arg.where['lastAttemptAt'] as { lte: Date };
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    expect(lastAttempt.lte.getTime()).toBeLessThanOrEqual(Date.now());
    expect(Math.abs(lastAttempt.lte.getTime() - sevenDaysAgo.getTime())).toBeLessThan(60_000);
    expect(arg.orderBy).toEqual({ lastAttemptAt: 'asc' });
    expect(arg.take).toBe(100);
  });

  it('filters out rows already at or over max_attempts in memory', async () => {
    findMany.mockResolvedValue([
      row({ id: BigInt(1), attemptCount: 1, maxAttempts: 3 }), // due
      row({ id: BigInt(2), attemptCount: 3, maxAttempts: 3 }), // at max → excluded
      row({ id: BigInt(3), attemptCount: 2, maxAttempts: 3 }), // due
      row({ id: BigInt(4), attemptCount: 5, maxAttempts: 3 }), // over max → excluded
    ]);
    const repo = new ReferralRepository();

    const result = await repo.findInvitesDueForResendBatch(100);

    expect(result.map((r) => r.id)).toEqual([BigInt(1), BigInt(3)]);
  });

  it('maps prisma rows to CustomerInviteRow shape', async () => {
    findMany.mockResolvedValue([row({ id: BigInt(7), phone: '9000000000' })]);
    const repo = new ReferralRepository();

    const [r] = await repo.findInvitesDueForResendBatch(10);

    expect(r).toMatchObject({
      id: BigInt(7),
      vendorId: BigInt(10),
      phone: '9000000000',
      status: 'SENT',
      attemptCount: 1,
      maxAttempts: 3,
      autoResend: true,
    });
  });
});
