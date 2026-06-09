/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { StaffNotificationLogAdapter } from '../adapters/staff-notification-log.adapter';
import { ListAssignmentWriteStubAdapter } from '../adapters/list-assignment-write-stub.adapter';
import { FeatureNotAvailableError } from '../domain/staff.errors';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;

describe('StaffNotificationLogAdapter (invariant 9 — log-and-continue)', () => {
  it('resolves and never throws on a normal send', async () => {
    const adapter = new StaffNotificationLogAdapter(logger);
    await expect(
      adapter.sendStaffInvite({
        phone: '+919900000210',
        vendorName: 'Acme',
        inviteUrl: 'https://app/accept-invite?token=x',
        channel: 'whatsapp',
        expiresAt: new Date(),
        correlationId: 'cid',
      })
    ).resolves.toBeUndefined();
  });

  it('swallows an internal logging failure instead of breaking the command', async () => {
    const throwingLogger = {
      info: jest.fn(() => {
        throw new Error('log sink down');
      }),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as any;
    const adapter = new StaffNotificationLogAdapter(throwingLogger);
    await expect(
      adapter.sendStaffInvite({
        phone: '+919900000210',
        vendorName: 'Acme',
        inviteUrl: 'https://app/accept-invite?token=x',
        channel: 'sms',
        expiresAt: new Date(),
        correlationId: 'cid',
      })
    ).resolves.toBeUndefined();
    expect(throwingLogger.warn).toHaveBeenCalled();
  });

  it('masks the phone number in the log payload', async () => {
    const spy = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
    const adapter = new StaffNotificationLogAdapter(spy);
    await adapter.sendStaffInvite({
      phone: '+919900000210',
      vendorName: 'Acme',
      inviteUrl: 'https://app/accept-invite?token=x',
      channel: 'whatsapp',
      expiresAt: new Date(),
      correlationId: 'cid',
    });
    const logged = spy.info.mock.calls[0][0] as { phone: string };
    expect(logged.phone).not.toBe('+919900000210');
    expect(logged.phone).toContain('•');
    expect(logged.phone.endsWith('210')).toBe(true);
  });
});

describe('ListAssignmentWriteStubAdapter (fail-closed 503 until US-005)', () => {
  const adapter = new ListAssignmentWriteStubAdapter(logger);

  it('assign rejects with FeatureNotAvailableError', async () => {
    await expect(adapter.assign(5n, 1n, true, 9n)).rejects.toBeInstanceOf(FeatureNotAvailableError);
  });

  it('unassign rejects with FeatureNotAvailableError', async () => {
    await expect(adapter.unassign(5n, 1n)).rejects.toBeInstanceOf(FeatureNotAvailableError);
  });

  it('setPrimary rejects with FeatureNotAvailableError', async () => {
    await expect(adapter.setPrimary(5n, 1n)).rejects.toBeInstanceOf(FeatureNotAvailableError);
  });

  it('the error carries a 503 status code', async () => {
    await adapter.assign(5n, 1n, false, 9n).catch((err: FeatureNotAvailableError) => {
      expect(err.statusCode).toBe(503);
      expect(err.code).toBe('FEATURE_NOT_AVAILABLE');
    });
  });
});
