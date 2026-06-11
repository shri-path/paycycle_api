/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { StaffNotificationLogAdapter } from '../adapters/staff-notification-log.adapter';

const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;

// NOTE (US-005 / OQ-6): the list-assignment write port is no longer a 503 stub.
// The staff composition root now wires the real SupplyListAssignmentWriteAdapter.
// Real-adapter behavior is covered in
// src/modules/supply-list/__tests__/acl-adapters.test.ts.

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
