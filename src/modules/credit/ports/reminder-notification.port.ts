/**
 * ReminderNotificationPort — Strategy interface for sending payment reminders.
 * Current implementation: log-stub. Future: WhatsApp/SMS adapter.
 */
import { ReminderChannelEnum } from '../domain/credit.types';

export interface ReminderNotificationInput {
  customerPhone: string;
  channel: ReminderChannelEnum;
  body: string;
  correlationId: string;
}

export interface ReminderNotificationResult {
  status: 'SENT' | 'FAILED';
}

export interface IReminderNotificationPort {
  send(input: ReminderNotificationInput): Promise<ReminderNotificationResult>;
}
