import { InviteChannel } from '../staff.types';

export interface StaffInviteNotification {
  phone: string;
  vendorName: string;
  inviteUrl: string;
  channel: InviteChannel;
  expiresAt: Date;
  correlationId: string;
}

/**
 * Outbound seam for delivering a staff invite over WhatsApp/SMS (Notifications
 * context, not yet built). Implementations MUST be log-and-continue — a delivery
 * failure is logged and swallowed; it never aborts the originating command
 * (invariant 9). The real provider (Twilio/Gupshup/etc.) lands in a later US.
 */
export interface StaffNotificationPort {
  sendStaffInvite(input: StaffInviteNotification): Promise<void>;
}
