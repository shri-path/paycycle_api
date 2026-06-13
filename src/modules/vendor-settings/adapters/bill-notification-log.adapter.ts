/**
 * BillNotificationLogAdapter — stub implementation of BillNotificationPort.
 * Logs to Pino and returns true. Never throws.
 * Mirrors auth/adapters/sms-stub.adapter.ts pattern.
 * Real WhatsApp/SMS adapter is a future story.
 */
import { logger } from '@/infrastructure/logger/logger';
import { BillNotificationPort } from '../ports/bill-notification.port';

export class BillNotificationLogAdapter implements BillNotificationPort {
  sendBill(phone: string, text: string): Promise<boolean> {
    logger.info(
      { adapter: 'BillNotificationLogAdapter', action: 'sendBill', phone, textLength: text.length },
      '[STUB] Bill notification logged — no real delivery in v1'
    );
    return Promise.resolve(true);
  }

  sendReminder(phone: string, text: string): Promise<boolean> {
    logger.info(
      {
        adapter: 'BillNotificationLogAdapter',
        action: 'sendReminder',
        phone,
        textLength: text.length,
      },
      '[STUB] Reminder notification logged — no real delivery in v1'
    );
    return Promise.resolve(true);
  }
}
