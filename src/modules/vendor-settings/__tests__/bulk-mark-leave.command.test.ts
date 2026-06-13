/**
 * Unit tests for BulkMarkLeaveCommand.
 */
import { BulkMarkLeaveCommand } from '../commands/bulk-mark-leave/bulk-mark-leave.command';
import { IVendorSettingsRepository } from '../database/vendor-settings.repository.port';
import { IBulkOperationRepository } from '../database/bulk-operation.repository.port';
import { BulkLeaveWriterPort } from '../ports/bulk-leave-writer.port';
import { BulkOperationEntity } from '../domain/bulk-operation/bulk-operation.entity';
import { BulkOperationStatus } from '../domain/bulk-operation/bulk-operation.types';
import { UnprocessableEntityError } from '@/common/errors/app-error';

const VENDOR_ID = 1n;
const USER_ID = 99n;
const TODAY = '2026-07-15';
const YESTERDAY = '2026-07-14';

describe('BulkMarkLeaveCommand', () => {
  let settingsRepo: jest.Mocked<IVendorSettingsRepository>;
  let bulkOpRepo: jest.Mocked<IBulkOperationRepository>;
  let leaveWriter: jest.Mocked<BulkLeaveWriterPort>;
  let cmd: BulkMarkLeaveCommand;

  beforeEach(() => {
    settingsRepo = {
      findByVendor: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      transaction: jest.fn(),
    };

    let opIdCounter = 1n;
    bulkOpRepo = {
      insert: jest.fn().mockImplementation((entity: BulkOperationEntity) => {
        entity.assignId(opIdCounter++);
        return Promise.resolve(entity);
      }),
      save: jest.fn().mockImplementation((entity: BulkOperationEntity) => Promise.resolve(entity)),
      findById: jest.fn(),
      findPending: jest.fn(),
    };

    leaveWriter = {
      resolveSubscriptions: jest.fn(),
      hasCoveringLeave: jest.fn().mockResolvedValue(false),
      createLeave: jest.fn().mockResolvedValue(undefined),
      markDeliveriesLeave: jest.fn().mockResolvedValue(1),
      today: jest.fn().mockReturnValue(TODAY),
    };

    cmd = new BulkMarkLeaveCommand(settingsRepo, bulkOpRepo, leaveWriter);
  });

  it('should complete successfully when targeting specific subscriptions', async () => {
    leaveWriter.resolveSubscriptions.mockResolvedValue([10n, 11n, 12n]);

    const result = await cmd.execute({
      vendorId: VENDOR_ID,
      subscriptionIds: [10n, 11n, 12n],
      date: TODAY,
      reason: 'Festival',
      performedByUserId: USER_ID,
      correlationId: 'test-corr',
    });

    expect(result.status).toBe(BulkOperationStatus.COMPLETED);
    expect(result.operationId).toBeDefined();
    expect(result.summary).toMatchObject({ customersAffected: 3, skipped: 0 });
  });

  it('should skip subscriptions with existing covering leave', async () => {
    leaveWriter.resolveSubscriptions.mockResolvedValue([10n, 11n]);
    leaveWriter.hasCoveringLeave
      .mockResolvedValueOnce(true) // sub 10 — has covering leave
      .mockResolvedValueOnce(false); // sub 11 — no leave

    const result = await cmd.execute({
      vendorId: VENDOR_ID,
      subscriptionIds: [10n, 11n],
      date: TODAY,
      performedByUserId: USER_ID,
    });

    expect(result.summary).toMatchObject({ customersAffected: 1, skipped: 1 });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(leaveWriter.createLeave).toHaveBeenCalledTimes(1);
  });

  it('should reject past date with 422', async () => {
    await expect(
      cmd.execute({
        vendorId: VENDOR_ID,
        subscriptionIds: [10n],
        date: YESTERDAY,
        performedByUserId: USER_ID,
      })
    ).rejects.toThrow(UnprocessableEntityError);
  });

  it('should return asyncProcessing=true when above concurrencyLimit', async () => {
    // 51 subscriptions, default limit = 50
    const ids = Array.from({ length: 51 }, (_, i) => BigInt(i + 1));
    leaveWriter.resolveSubscriptions.mockResolvedValue(ids);

    const result = await cmd.execute({
      vendorId: VENDOR_ID,
      all: true,
      date: TODAY,
      performedByUserId: USER_ID,
    });

    expect(result.asyncProcessing).toBe(true);
    expect(result.status).toBe(BulkOperationStatus.PENDING);
    // Should NOT have called createLeave
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(leaveWriter.createLeave).not.toHaveBeenCalled();
  });

  it('should mark op as FAILED and persist when processing throws', async () => {
    leaveWriter.resolveSubscriptions.mockResolvedValue([10n]);
    leaveWriter.createLeave.mockRejectedValue(new Error('DB error'));

    await expect(
      cmd.execute({
        vendorId: VENDOR_ID,
        subscriptionIds: [10n],
        date: TODAY,
        performedByUserId: USER_ID,
        correlationId: 'fail-corr',
      })
    ).rejects.toThrow(UnprocessableEntityError);

    // save should have been called at least once with a failed entity
    const saveCalls = bulkOpRepo.save.mock.calls;
    const lastSavedEntity = saveCalls[saveCalls.length - 1]?.[0] as BulkOperationEntity;
    expect(lastSavedEntity.status).toBe(BulkOperationStatus.FAILED);
  });
});
