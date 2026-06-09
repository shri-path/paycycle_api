import { Logger } from '@/infrastructure/logger/logger';
import { StaffNotificationPort, StaffInviteNotification } from '../ports/staff-notification.port';

/**
 * Log-and-continue stub for the staff-invite notification seam (invariant 9).
 *
 * Until a real WhatsApp/SMS provider is integrated, this adapter records the
 * would-be message — masked phone, channel, invite URL, expiry, correlationId —
 * via structured logging. It NEVER throws into the request path: any internal
 * failure is caught and logged so the originating command (invite/resend) always
 * commits successfully.
 */
export class StaffNotificationLogAdapter implements StaffNotificationPort {
  constructor(private readonly logger: Logger) {}

  // Not `async`: the body is synchronous, and the project's require-await rule
  // forbids an async method with no await. Returning Promise.resolve() satisfies
  // the port's Promise<void> contract (log-and-continue — never throws).
  sendStaffInvite(input: StaffInviteNotification): Promise<void> {
    try {
      this.logger.info(
        {
          channel: input.channel,
          phone: maskPhone(input.phone),
          vendorName: input.vendorName,
          inviteUrl: input.inviteUrl,
          expiresAt: input.expiresAt.toISOString(),
          correlationId: input.correlationId,
        },
        'StaffNotificationLogAdapter: staff invite delivery (stub — no real provider)'
      );
    } catch (error) {
      // Defensive: never let a logging/formatting failure bubble into the command.
      this.logger.warn(
        { err: error, correlationId: input.correlationId },
        'StaffNotificationLogAdapter: failed to log invite delivery — continuing'
      );
    }
    return Promise.resolve();
  }
}

/**
 * Mask a phone number for logs: keep the country/prefix and last 3 digits,
 * dot out the middle. e.g. +919900000210 → +9199•••••210.
 */
function maskPhone(phone: string): string {
  if (!phone) return '';
  const visiblePrefix = 4;
  const visibleSuffix = 3;
  if (phone.length <= visiblePrefix + visibleSuffix) {
    return phone;
  }
  const prefix = phone.slice(0, visiblePrefix);
  const suffix = phone.slice(-visibleSuffix);
  const masked = '•'.repeat(phone.length - visiblePrefix - visibleSuffix);
  return `${prefix}${masked}${suffix}`;
}
