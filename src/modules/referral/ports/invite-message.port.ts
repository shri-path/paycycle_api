/**
 * InviteMessagePort — Strategy port for WhatsApp/SMS outreach.
 * Stub adapter used in v1.
 */
export interface SendInviteInput {
  phone: string;
  body: string;
  language: string;
}

export interface IInviteMessagePort {
  id: string;
  send(input: SendInviteInput): Promise<{ success: boolean; messageId?: string }>;
}
