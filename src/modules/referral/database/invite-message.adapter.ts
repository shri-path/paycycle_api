/**
 * Stub WhatsApp adapter for InviteMessagePort.
 * Logs the message; a real implementation would call the WhatsApp API.
 */
import { logger } from '@/infrastructure/logger/logger';
import { IInviteMessagePort, SendInviteInput } from '../ports/invite-message.port';

export class StubInviteMessageAdapter implements IInviteMessagePort {
  readonly id = 'whatsapp-stub';

  send(input: SendInviteInput): Promise<{ success: boolean; messageId?: string }> {
    logger.info(
      { phone: input.phone, language: input.language, bodyLength: input.body.length },
      'InviteMessagePort [STUB] — would send WhatsApp invite'
    );
    // Simulate success
    return Promise.resolve({ success: true, messageId: `stub-${Date.now()}` });
  }
}
