/**
 * ReminderNotificationLogAdapter — log-stub implementation of ReminderNotificationPort.
 * Masks phone numbers in logs. Never throws. Returns SENT.
 * A real WhatsApp/SMS adapter can replace this at the composition root.
 */
import { logger } from '@/infrastructure/logger/logger';
import {
  IReminderNotificationPort,
  ReminderNotificationInput,
  ReminderNotificationResult,
} from '../ports/reminder-notification.port';

function maskPhone(phone: string): string {
  if (phone.length <= 4) return '****';
  return phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4);
}

export class ReminderNotificationLogAdapter implements IReminderNotificationPort {
  send(input: ReminderNotificationInput): Promise<ReminderNotificationResult> {
    logger.info(
      {
        correlationId: input.correlationId,
        channel: input.channel,
        phone: maskPhone(input.customerPhone),
        bodyLength: input.body.length,
      },
      'ReminderNotification: log-stub — would send via ' + input.channel
    );
    return Promise.resolve({ status: 'SENT' });
  }
}
