/**
 * Unit tests — InviteResendSweep cron (US-15.4).
 *
 * Covers the resend orchestration in isolation via the injectable
 * `runInviteResendSweep(deps)` seam (no live DB):
 *   - resends due invites and increments the attempt
 *   - marks FAILED once max_attempts is reached (anti-spam stop)
 *   - transport failure still counts the attempt (does not crash the sweep)
 *   - one bad invite does not abort the rest of the batch
 *   - vendor with no referral code is skipped without mutation
 *   - the batch cap is passed through to the bounded query
 *
 * Due-invite SELECTION (7-day window, attempt<max, status not signed_up/failed)
 * is enforced by `findInvitesDueForResendBatch` in the repository and exercised
 * by the integration test; here that query is mocked and the orchestration that
 * consumes its rows is verified.
 */
import { runInviteResendSweep, InviteResendSweepDeps } from '../../referral.cron';
import { CustomerInviteRow } from '../../database/referral.repository.port';
import { IInviteMessagePort } from '../../ports/invite-message.port';

function makeInvite(overrides: Partial<CustomerInviteRow> = {}): CustomerInviteRow {
  const eightDaysAgo = new Date();
  eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
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
    sentAt: eightDaysAgo,
    lastAttemptAt: eightDaysAgo,
    signedUpAt: null,
    createdAt: eightDaysAgo,
    updatedAt: eightDaysAgo,
    deletedAt: null,
    ...overrides,
  };
}

type SendResult = { success: boolean; messageId?: string };
type SendFn = jest.Mock<Promise<SendResult>, [{ phone: string; body: string; language: string }]>;

interface TestMessagePort {
  port: IInviteMessagePort;
  send: SendFn;
}

function makeMessagePort(success = true): TestMessagePort {
  const send: SendFn = jest.fn<
    Promise<SendResult>,
    [{ phone: string; body: string; language: string }]
  >();
  send.mockResolvedValue({ success, messageId: 'm-1' });
  return { port: { id: 'test-stub', send }, send };
}

type RepoMock = jest.Mocked<InviteResendSweepDeps['repository']>;

function makeRepo(due: CustomerInviteRow[]): RepoMock {
  return {
    findInvitesDueForResendBatch: jest.fn().mockResolvedValue(due),
    getVendorReferralCode: jest.fn().mockResolvedValue('MILK1234'),
    incrementInviteAttempt: jest.fn().mockResolvedValue(undefined),
    updateInviteStatus: jest.fn().mockResolvedValue(undefined),
    transaction: jest.fn().mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      return cb({});
    }),
  };
}

describe('runInviteResendSweep (US-15.4)', () => {
  it('resends a due invite and increments the attempt without marking FAILED', async () => {
    const invite = makeInvite({ id: BigInt(1), attemptCount: 1, maxAttempts: 3 });
    const repository = makeRepo([invite]);
    const { port, send } = makeMessagePort(true);

    await runInviteResendSweep({ repository, messagePort: port });

    expect(send).toHaveBeenCalledTimes(1);
    const sent = send.mock.calls[0]?.[0];
    expect(sent?.phone).toBe('9876543210');
    expect(sent?.language).toBe('hi');
    expect(sent?.body).toContain('MILK1234');

    expect(repository.incrementInviteAttempt).toHaveBeenCalledWith(BigInt(1), expect.anything());
    expect(repository.updateInviteStatus).not.toHaveBeenCalled();
  });

  it('marks FAILED when the resend reaches max_attempts (anti-spam stop)', async () => {
    // attemptCount 2 of max 3 → this resend is the 3rd attempt → stop.
    const invite = makeInvite({ id: BigInt(2), attemptCount: 2, maxAttempts: 3 });
    const repository = makeRepo([invite]);
    const { port } = makeMessagePort(true);

    await runInviteResendSweep({ repository, messagePort: port });

    expect(repository.incrementInviteAttempt).toHaveBeenCalledWith(BigInt(2), expect.anything());
    expect(repository.updateInviteStatus).toHaveBeenCalledWith(
      BigInt(2),
      'FAILED',
      expect.anything()
    );
  });

  it('increments the attempt even when the transport reports failure (edge case #3)', async () => {
    const invite = makeInvite({ id: BigInt(3), attemptCount: 1, maxAttempts: 3 });
    const repository = makeRepo([invite]);
    const { port } = makeMessagePort(false); // transport failure

    await runInviteResendSweep({ repository, messagePort: port });

    expect(repository.incrementInviteAttempt).toHaveBeenCalledWith(BigInt(3), expect.anything());
    expect(repository.updateInviteStatus).not.toHaveBeenCalled();
  });

  it('skips an invite whose vendor has no referral code without mutating it', async () => {
    const invite = makeInvite({ id: BigInt(4), vendorId: BigInt(99) });
    const repository = makeRepo([invite]);
    repository.getVendorReferralCode.mockResolvedValue(null);
    const { port, send } = makeMessagePort(true);

    await runInviteResendSweep({ repository, messagePort: port });

    expect(send).not.toHaveBeenCalled();
    expect(repository.incrementInviteAttempt).not.toHaveBeenCalled();
    expect(repository.updateInviteStatus).not.toHaveBeenCalled();
  });

  it('continues the batch when one invite throws (does not abort the sweep)', async () => {
    const bad = makeInvite({ id: BigInt(5) });
    const good = makeInvite({ id: BigInt(6) });
    const repository = makeRepo([bad, good]);
    // First send throws, second succeeds.
    const { port, send } = makeMessagePort(true);
    send
      .mockRejectedValueOnce(new Error('transport boom'))
      .mockResolvedValueOnce({ success: true, messageId: 'm-2' });

    await runInviteResendSweep({ repository, messagePort: port });

    // The good invite is still processed despite the bad one throwing.
    expect(repository.incrementInviteAttempt).toHaveBeenCalledTimes(1);
    expect(repository.incrementInviteAttempt).toHaveBeenCalledWith(BigInt(6), expect.anything());
  });

  it('caches the referral-code lookup per vendor within a run', async () => {
    const a = makeInvite({ id: BigInt(7), vendorId: BigInt(50) });
    const b = makeInvite({ id: BigInt(8), vendorId: BigInt(50) });
    const repository = makeRepo([a, b]);
    const { port, send } = makeMessagePort(true);

    await runInviteResendSweep({ repository, messagePort: port });

    expect(repository.getVendorReferralCode).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('passes the configured batch size to the bounded query', async () => {
    const repository = makeRepo([]);
    const { port } = makeMessagePort(true);

    await runInviteResendSweep({ repository, messagePort: port, batchSize: 25 });

    expect(repository.findInvitesDueForResendBatch).toHaveBeenCalledWith(25);
  });

  it('swallows a failure from the bounded query (sweep never throws)', async () => {
    const repository = makeRepo([]);
    repository.findInvitesDueForResendBatch.mockRejectedValue(new Error('db down'));
    const { port } = makeMessagePort(true);

    await expect(runInviteResendSweep({ repository, messagePort: port })).resolves.toBeUndefined();
  });
});
