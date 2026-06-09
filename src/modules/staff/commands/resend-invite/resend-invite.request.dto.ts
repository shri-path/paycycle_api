import { InviteChannel } from '../../staff.types';

export interface ResendInviteRequestDto {
  vendorId: bigint;
  staffId: bigint;
  performedByUserId: bigint;
  performedByRole: string;
  /** WhatsApp/SMS channel; null = unspecified (defaults to whatsapp for delivery). */
  sendVia: InviteChannel | null;
  ip: string | null;
  userAgent: string | null;
}
